/**
 * SpendSense Gmail -> Sheet sync.
 *
 * Runs entirely inside Google's infrastructure (Apps Script), bound to the
 * SpendSense Google Sheet. No credentials to manage: Gmail and Sheets access
 * both come from the script's own OAuth grant to your Google account.
 *
 * SETUP (one-time):
 *   1. Open the Sheet -> Extensions -> Apps Script.
 *   2. Replace the default Code.gs content with this file, save.
 *   3. Run `runSpendSenseSync` once from the editor's function dropdown to
 *      trigger the OAuth consent screen (Gmail + Sheets) and do a first pass.
 *   4. Run `createDailyTrigger` once to install the recurring schedule.
 *
 * To change how often it runs, edit createDailyTrigger(). To add a new email
 * source, add a new `process*` function following the existing pattern and
 * call it from runSpendSenseSync().
 */

const INVOICES_SHEET = "Invoices_Raw";
const NEEDS_REVIEW_SHEET = "Needs_Review";
const PROCESSED_LABEL = "SpendSense/Processed";
const IGNORED_LABEL = "SpendSense/Ignored";
const NEEDS_REVIEW_LABEL = "SpendSense/NeedsReview";

// Only look at mail from the last 6 months — this app tracks recent spend,
// not a full financial history. Change the "6m" to widen/narrow the window.
const DATE_FILTER = "newer_than:6m";

// Apps Script hard-caps a single execution at 6 minutes. There's ~2 years of
// mail to backfill, so each run only takes a bounded slice per source —
// already-labeled threads are excluded from the next search, so repeated
// runs (the daily trigger, or you clicking Run a few times to speed up the
// initial backfill) work through the backlog incrementally. Lower this if a
// run still times out; raise it once the backlog is cleared.
const MAX_THREADS_PER_SOURCE = 30;

// Stop starting new sources once this much of the 6-minute budget is used,
// so a run ends cleanly instead of being killed mid-write.
const TIME_BUDGET_MS = 4.5 * 60 * 1000;

// --- Category keyword rules (grocery item name -> category) --------------
// Checked in order; first match wins. Extend these lists as new items show
// up miscategorized.
// Checked in this order because branded/packaged snack names often contain
// a raw-ingredient word as a flavor descriptor — e.g. "Lay's Crunchy POTATO
// Chips" or "NOICE Chakli (No Palm OIL...)" — which would otherwise
// false-match "potato"/"oil" under produce/staples before ever reaching the
// "chips"/"chakli" snack keyword. Snacks (and other packaged-goods
// categories) go first; raw-ingredient categories go last since their
// keywords are the most generic and most likely to appear incidentally.
const ITEM_CATEGORY_RULES = [
  ["snacks", ["chips", "biscuit", "chocolate", "cookie", "wafer", "ice cream", "gelato",
    "cola", "soda", "soft drink", "ginger ale", "namkeen", "chakli", "coffee", "drink",
    "cadbury", "makhana", "dairy milk"]],
  ["personal_care", ["shampoo", "soap", "sunscreen", "face wash", "body wash", "conditioner",
    "lotion", "period", "panties", "skincare", "glow"]],
  ["household", ["detergent", "dettol", "cleaner", "tissue", "paper towel", "antiseptic"]],
  // Raw meat/fish cuts — checked before staples/dairy so "chicken curry cut"
  // etc. don't fall into pantry goods. Doesn't include "masala" so a spice
  // blend like "Chicken Masala Powder" correctly matches "spices" below
  // instead (checked before "meat_seafood" wouldn't matter here since
  // "masala" isn't a meat_seafood keyword, but keeping the note for clarity).
  ["meat_seafood", ["chicken curry", "mutton", "fish", "prawn", "seafood", "curry cut", "boneless"]],
  ["dairy_eggs", ["milk", "curd", "paneer", "buttermilk", "ghee", "cheese", "yogurt", "egg"]],
  // "staples" split into specific pantry categories instead of one blended
  // bucket. Order matters where words could collide (e.g. none currently do
  // between these, but "oil" stays isolated in "oils" now that snacks/
  // personal_care are checked earlier and catch "No Palm Oil" phrasing).
  ["spices", ["masala", "spice powder", "chilli powder", "turmeric", "jeera"]],
  ["rice", ["rice", "basmati", "pulav"]],
  ["oils", ["oil"]],
  ["grains", ["flour", "atta", "cereal"]],
  ["pulses", ["dal", "lentil"]],
  ["sugar", ["sugar"]],
  ["tea_coffee", ["tea ", " tea"]],
  ["bakery", ["bread"]],
  ["instant_food", ["noodles", "instant"]],
  ["vegetables", ["tomato", "capsicum", "chilli", "chili", "potato", "mushroom", "brinjal",
    "cauliflower", "beans", "coriander", "ginger", "onion", "peas", "vegetable", "coccinia",
    "haricot"]],
  ["fruits", ["banana", "avocado", "muskmelon", "chikoo", "sapota", "fruit"]],
];

function categorizeGroceryItem(name) {
  if (!name) return "other";
  const lower = name.toLowerCase();
  for (const [category, keywords] of ITEM_CATEGORY_RULES) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "other";
}

// --- Sheet helpers ---------------------------------------------------------

function getInvoicesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(INVOICES_SHEET);
}

function getOrCreateNeedsReviewSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(NEEDS_REVIEW_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NEEDS_REVIEW_SHEET);
    sheet.appendRow(["Date", "Vendor", "Description", "Amount", "GmailLink", "Reason"]);
  }
  return sheet;
}

// Sheets sometimes auto-converts a "YYYY-MM-DD" string into an actual date
// serial number on append (observed inconsistently during rapid consecutive
// appends), which then reads back as a bare number like "46235" instead of
// the date string. Forcing the cell to plain-text format after writing it
// prevents that silently-wrong conversion.
function forceTextCell_(sheet, row, col, value) {
  sheet.getRange(row, col).setNumberFormat("@").setValue(value);
}

function appendInvoiceRow_(date, vendor, orderId, item, category, amount, fee, quantity) {
  const sheet = getInvoicesSheet_();
  sheet.appendRow([date, vendor, orderId, item, category, amount, fee || 0, quantity || 1]);
  forceTextCell_(sheet, sheet.getLastRow(), 1, date);
}

function appendNeedsReview_(date, vendor, description, amount, message, reason) {
  const link = "https://mail.google.com/mail/u/0/#inbox/" + message.getId();
  const sheet = getOrCreateNeedsReviewSheet_();
  sheet.appendRow([date, vendor, description, amount, link, reason]);
  forceTextCell_(sheet, sheet.getLastRow(), 1, date);
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function toIsoDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function parseAmount_(str) {
  return parseFloat(str.replace(/,/g, ""));
}

// Axis alerts inconsistently use DD-MM-YY or DD-MM-YYYY. Normalize to ISO.
function normalizeAxisDate_(dateStr) {
  const [d, m, y] = dateStr.split("-");
  const yyyy = y.length === 2 ? "20" + y : y;
  return `${yyyy}-${m}-${d}`;
}

// --- Source 1: Instamart grocery orders -------------------------------------

function processInstamartOrders() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'subject:"Instamart order was successfully delivered" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processInstamartOrders: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const orderIdMatch = body.match(/order id:\s*(\d+)/i);
      if (!orderIdMatch) return; // not an order-confirmation shaped email; leave unlabeled, retry next run
      const orderId = orderIdMatch[1];
      const date = toIsoDate_(message.getDate());

      // Item lines look like "1 x Some Item Name ₹81.00" with no delimiters,
      // and long names can wrap onto a second line before the ₹ amount — so
      // match lazily across any whitespace/newlines between "N x" and "₹".
      const itemsSection = body.split(/Order Items/i)[1]?.split(/Order Summary/i)[0] || "";
      const itemLines = [...itemsSection.matchAll(/(\d+)\s*x\s+([\s\S]+?)\s*₹([\d,.]+)/g)]
        .filter(([, , rawName, rawAmount]) => rawName && rawAmount);

      let wroteSomething = false;

      itemLines.forEach(([, rawQty, rawName, rawAmount]) => {
        const amount = parseAmount_(rawAmount);
        if (!amount) return; // skip free promo "flyer" placeholder items
        const item = rawName.trim();
        const quantity = parseInt(rawQty, 10) || 1;
        appendInvoiceRow_(date, "Swiggy Instamart", orderId, item, categorizeGroceryItem(item), amount, 0, quantity);
        wroteSomething = true;
      });

      const feeMatch = body.match(/Handling Fee\s*₹([\d,.]+)/);
      if (feeMatch) {
        appendInvoiceRow_(date, "Swiggy Instamart", orderId, "Handling Fee", "fees", parseAmount_(feeMatch[1]), 0);
        wroteSomething = true;
      }

      if (wroteSomething) {
        message.getThread().addLabel(processed);
      } else {
        // Different email template than the parser expects — don't guess, flag it.
        const totalMatch = body.match(/Grand Total\s*₹([\d,.]+)/);
        appendNeedsReview_(
          date, "Swiggy Instamart", "Order " + orderId + " — item table didn't match parser format",
          totalMatch ? parseAmount_(totalMatch[1]) : "", message,
          "Different email template — parser found no item lines"
        );
        message.getThread().addLabel(needsReview);
      }
    });
  });
}

// --- Source 2: Swiggy restaurant (dining out) orders ------------------------

// Restaurant name sits on its own line after "ORDER JOURNEY", following one
// or more "[image: ...]" placeholder lines and blank lines, and before the
// address line (which starts with a house/plot number).
function extractRestaurantName_(body, orderId) {
  const journeyIdx = body.indexOf("ORDER JOURNEY");
  if (journeyIdx === -1) return "Swiggy order " + orderId;

  const lines = body
    .slice(journeyIdx + "ORDER JOURNEY".length)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    if (line.startsWith("[image")) continue;
    if (/^\d/.test(line)) break; // hit the address line — no name found before it
    return line;
  }
  return "Swiggy order " + orderId;
}

function processSwiggyDiningOrders() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'subject:("Swiggy order was delivered" OR "Swiggy order was successfully delivered" OR "Swiggy Gourmet order") ' +
      '-subject:Instamart -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processSwiggyDiningOrders: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const orderIdMatch = body.match(/Order ID:\s*(\d+)/i);
      const totalMatch = body.match(/Paid Via[\s\S]*?₹\s*([\d,.]+)/i);
      if (!orderIdMatch || !totalMatch) return;

      const orderId = orderIdMatch[1];
      const amount = parseAmount_(totalMatch[1]);
      const date = toIsoDate_(message.getDate());
      const restaurant = extractRestaurantName_(body, orderId);

      appendInvoiceRow_(date, "Swiggy", orderId, restaurant, "dining_out", amount, 0);
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 3: ICICI credit card transaction alerts -------------------------

const CARD_MERCHANT_CATEGORY_RULES = [
  ["subscriptions", ["anthropic", "netflix", "spotify", "prime video", "youtube premium"]],
  ["shopping", ["amazon", "asspl", "flipkart", "myntra", "blink comme", "blinkit"]],
  ["transport", ["rapido", "uber", "ola cabs", "olacabs", "metro", "bmrcl", "cmrl",
    "redbus", "irctc"]],
  ["utilities", ["tnpdcl", "electricity", "bescom", "water board", "gas",
    "broadband", "airtel", "jio", "vodafone", "vi recharge"]],
  ["dining_out", ["starbucks"]],
  ["travel", ["makemytrip", "make my trip", "goibibo", "yatra"]],
];

// Merchant names that are ALREADY captured via their own dedicated source
// (Instamart/Swiggy receipt emails) — a card transaction alert for these is
// just the payment leg of an order recorded elsewhere, not new spend.
// Recording it too would double-count. Matched against the raw merchant
// string from the bank alert (these are truncated/garbled processor names,
// not the clean merchant names Swiggy itself uses).
const ALREADY_CAPTURED_MERCHANT_KEYWORDS = ["swiggy", "instamart", "bundl techn", "raz*", "cas*"];

function isAlreadyCapturedElsewhere_(merchant) {
  const lower = merchant.toLowerCase();
  return ALREADY_CAPTURED_MERCHANT_KEYWORDS.some((k) => lower.includes(k));
}

function categorizeCardMerchant_(merchant) {
  const lower = merchant.toLowerCase();
  for (const [category, keywords] of CARD_MERCHANT_CATEGORY_RULES) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return null; // unrecognized merchant -> Needs_Review, not a guess
}

function processIciciCardAlerts() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'subject:"Transaction alert for your ICICI Bank Credit Card" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIciciCardAlerts: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      // Amount and date must stay in ONE pattern (not two independent
      // body-wide searches) — the email footer contains other unrelated
      // "on <date>" boilerplate that an independent date search can match
      // instead of the real transaction date. Only the whitespace between
      // "INR" and the amount needs \s+ tolerance for the occasional
      // line-wrap; keeping amount+date tied together anchors the date to
      // the correct sentence.
      const amountDateMatch = body.match(/transaction of INR\s+([\d,.]+)\s+on\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/);
      const merchantMatch = body.match(/Info:\s*([^.\n]+)\./);
      if (!amountDateMatch || !merchantMatch) return;

      const amount = parseAmount_(amountDateMatch[1]);
      const merchant = merchantMatch[1].trim();
      const date = toIsoDate_(new Date(amountDateMatch[2]));
      const category = categorizeCardMerchant_(merchant);

      if (category) {
        appendInvoiceRow_(date, "ICICI Bank Credit Card", "ICICI-" + message.getId(), merchant, category, amount, 0);
        message.getThread().addLabel(processed);
      } else {
        appendNeedsReview_(date, "ICICI Bank Credit Card", merchant, amount, message, "Unrecognized merchant — pick a category");
        message.getThread().addLabel(needsReview);
      }
    });
  });
}

// --- Source 4: Axis Bank UPI bill payments (utilities) ----------------------

function processAxisUpiBillPayments() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"payment successful" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisUpiBillPayments: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Amount paid:\s*INR\s*([\d,.]+)/i);
      const billerMatch = body.match(/Biller name:\s*([\s\S]+?)\s*Consumer/i);
      if (!amountMatch || !billerMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const biller = billerMatch[1].trim();
      const date = toIsoDate_(message.getDate());
      const category = categorizeCardMerchant_(biller);

      if (category) {
        appendInvoiceRow_(date, "Axis Bank UPI", "AXIS-" + message.getId(), biller + " bill", category, amount, 0);
        message.getThread().addLabel(processed);
      } else {
        appendNeedsReview_(date, "Axis Bank UPI", biller + " bill payment", amount, message, "Unrecognized biller — confirm category");
        message.getThread().addLabel(needsReview);
      }
    });
  });
}

// --- Source 5: known recurring debits (insurance, etc.) ---------------------

function processAxisRecurringDebits() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"Debit transaction alert" "ACH-DR-HDFCLifeInsuranceCo" -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisRecurringDebits: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const match = body.match(/debited with INR ([\d,.]+) on (\d{2}-\d{2}-\d{2,4})/);
      if (!match) return;

      const amount = parseAmount_(match[1]);
      const date = normalizeAxisDate_(match[2]);

      appendInvoiceRow_(date, "Axis Bank", "AXIS-ACH-" + message.getId(), "Life insurance premium (HDFC Life)", "other", amount, 0);
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 6: RedBus bus tickets (transport) -------------------------------

function processRedBusTickets() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  // Scoped to the actual ticket-confirmation sender/subject, not the
  // greetings@travel.e-redbus.in marketing domain (which sends near-daily
  // promo mail) or the "Tax Invoice" / "Rate your experience" duplicates of
  // the same booking.
  const threads = GmailApp.search(
    'from:no-reply@redbus.in subject:"redBus Ticket -" -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processRedBusTickets: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const ticketMatch = body.match(/Ticket Number:\s*\*?([A-Za-z0-9]+)\*?/i);
      const priceMatch = body.match(/Ticket Price[\s\S]*?Rs\.?\s*([\d,.]+)/i);
      const routeMatch = body.match(/Ticket Information\s+([A-Za-z\s]+-[A-Za-z\s]+)\s+on/i);
      if (!ticketMatch || !priceMatch) return;

      const route = routeMatch ? routeMatch[1].trim() : "Bus ticket";
      appendInvoiceRow_(
        toIsoDate_(message.getDate()), "redBus", ticketMatch[1], route, "transport",
        parseAmount_(priceMatch[1]), 0
      );
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 7: IRCTC train bookings (transport) -----------------------------

function processIrctcBookings() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:ticketadmin@irctc.co.in subject:"Booking Confirmation" -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIrctcBookings: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      // Labels render as "*Label :*" (markdown-bold asterisks, no table
      // pipes) — e.g. "*PNR No. :* 4554529510", "*From : * MGR CHENNAI CTL
      // (MAS) *Date of Journey : *". The "To" value can wrap onto its own
      // line before the next label, so its capture spans newlines.
      const pnrMatch = body.match(/PNR No\.\s*:\s*\*+\s*(\d+)/i);
      // The Total Fare cell is the only "Rs. X" followed directly by the
      // footnote asterisks, e.g. "Rs. 422.25 ***".
      const fareMatch = body.match(/Rs\.\s*([\d,.]+)\s*\*+/);
      const fromMatch = body.match(/From\s*:\s*\*+\s*([\s\S]+?)\*Date of Journey/i);
      const toMatch = body.match(/\*To\s*:\s*\*+\s*([\s\S]+?)\*Boarding At/i);
      if (!pnrMatch || !fareMatch) return;

      const clean = (s) => s.replace(/\s+/g, " ").trim();
      const route = fromMatch && toMatch ? `${clean(fromMatch[1])} - ${clean(toMatch[1])}` : "Train ticket";
      appendInvoiceRow_(
        toIsoDate_(message.getDate()), "IRCTC", pnrMatch[1], route, "transport",
        parseAmount_(fareMatch[1]), 0
      );
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 8: Axis My Zone per-transaction alerts --------------------------

// Originally thought to have no per-purchase alerts (only found under the
// wrong search — the statement says "ending XX85" but the real transaction
// alerts use the full 4-digit suffix "XX5085"). It does send them, subject
// "INR <amt> spent on credit card no. XX5085". Every transaction found on
// this card so far has been Swiggy/Instamart/Bundl Technologies (Swiggy's
// payment processor) — i.e. this card is the auto-pay method for an account
// whose orders are ALREADY itemized via the dedicated Instamart/Swiggy
// receipt sources. Recording these too would double-count (confirmed: a
// ₹2044 "BUNDL TECHN" charge here exactly matched an existing Instamart
// order's grand total, same date). So merchants matching
// ALREADY_CAPTURED_MERCHANT_KEYWORDS are skipped entirely — not even flagged
// to Needs_Review, since we know for certain they're duplicates, not
// ambiguous. A genuinely different merchant on this card (if one ever shows
// up) still gets itemized normally.
function processAxisMyZoneTransactions() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"spent on credit card no. XX5085" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisMyZoneTransactions: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Transaction Amount:\s*\n*\s*INR\s*([\d,.]+)/i);
      const merchantMatch = body.match(/Merchant Name:\s*\n*\s*([^\n]+)/i);
      if (!amountMatch || !merchantMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const merchant = merchantMatch[1].trim();
      const date = toIsoDate_(message.getDate());

      if (isAlreadyCapturedElsewhere_(merchant)) {
        message.getThread().addLabel(processed); // known duplicate — skip silently, no row
        return;
      }
      if (/bill\s*p/i.test(merchant)) {
        appendNeedsReview_(date, "Axis My Zone (XX85)", merchant, amount, message,
          "Possible duplicate of a bill already recorded via a UPI payment alert — confirm before adding");
        message.getThread().addLabel(needsReview);
        return;
      }

      const category = categorizeCardMerchant_(merchant);
      if (category) {
        appendInvoiceRow_(date, "Axis My Zone (XX85)", "AXIS-MZ-" + message.getId(), merchant, category, amount, 0);
        message.getThread().addLabel(processed);
      } else {
        appendNeedsReview_(date, "Axis My Zone (XX85)", merchant, amount, message, "Unrecognized merchant — pick a category");
        message.getThread().addLabel(needsReview);
      }
    });
  });
}

// --- Source 9: Axis Neo Rupay per-transaction alerts -------------------------

// Subject "INR <amt> spent on credit card no. XX8482". A separate
// "Transaction ... Declined" subject exists for failed attempts — excluded
// by only matching the "spent on" subject.
//
// One wrinkle: paying a bill through Axis's in-app bill-pay feature with
// this card generates BOTH this alert AND a separate "payment successful"
// UPI-style alert for the same underlying bill (confirmed: a ₹668 charge
// here exactly matched an already-recorded TNPDCL electricity payment, same
// date and amount). Recording both would double-count, so anything that
// looks like a bill-pay merchant is flagged to Needs_Review instead of
// auto-recorded — a human can confirm whether it's a duplicate.
function processAxisNeoRupayTransactions() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"spent on credit card no. XX8482" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisNeoRupayTransactions: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Transaction Amount:\s*\n*\s*INR\s*([\d,.]+)/i);
      const merchantMatch = body.match(/Merchant Name:\s*\n*\s*([^\n]+)/i);
      if (!amountMatch || !merchantMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const merchant = merchantMatch[1].trim();
      const date = toIsoDate_(message.getDate());

      if (isAlreadyCapturedElsewhere_(merchant)) {
        message.getThread().addLabel(processed);
        return;
      }
      if (/bill\s*p/i.test(merchant)) {
        appendNeedsReview_(date, "Axis Neo Rupay (XX82)", merchant, amount, message,
          "Possible duplicate of a bill already recorded via a UPI payment alert — confirm before adding");
        message.getThread().addLabel(needsReview);
        return;
      }

      const category = categorizeCardMerchant_(merchant) || "other";
      appendInvoiceRow_(
        date, "Axis Neo Rupay (XX82)", "AXIS-NEO-" + message.getId(), merchant, category, amount, 0
      );
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 10: Scapia (Federal Bank) per-transaction alerts ----------------

// Genuine itemized alerts exist: subject "Your transaction was successful!"
// from scapiacards@federalbank.co.in — separate from "Your repayment is
// successful" (a bill settlement, excluded here the same way Axis
// CreditCard Payment debits are — it would double-count the transactions
// already recorded via this same source).
function processScapiaTransactions() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'from:scapiacards@federalbank.co.in subject:"Your transaction was successful" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processScapiaTransactions: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Amount\s*₹\s*([\d,.]+)/i);
      const merchantMatch = body.match(/Merchant\s+([^\n]+)/i);
      if (!amountMatch || !merchantMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const merchant = merchantMatch[1].trim();
      const date = toIsoDate_(message.getDate());
      const category = categorizeCardMerchant_(merchant);

      if (category) {
        appendInvoiceRow_(date, "Federal Bank (Scapia Card)", "SCAPIA-" + message.getId(), merchant, category, amount, 0);
        message.getThread().addLabel(processed);
      } else {
        appendNeedsReview_(date, "Federal Bank (Scapia Card)", merchant, amount, message, "Unrecognized merchant — pick a category");
        message.getThread().addLabel(needsReview);
      }
    });
  });
}

// --- Explicitly ignored: marketing, OTPs, incoming credits, card-bill ------
// settlements (would double-count spend already captured via the card-
// transaction alerts above), and large P2A/IMPS transfers (ambiguous
// purpose — flagged for manual review instead of guessed at).

function processIgnoredAndFlaggedNoise() {
  const ignored = getOrCreateLabel_(IGNORED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);

  // Pure noise: never worth a row.
  const ignoreThreads = GmailApp.search(
    'subject:(OTP OR "activate upi" OR "upi fraud" OR "scapia coins" OR "upi stays free") ' +
      '-label:' + IGNORED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIgnoredAndFlaggedNoise: %s noise threads to ignore", ignoreThreads.length);
  ignoreThreads.forEach((thread) => thread.addLabel(ignored));

  // Large transfers / card-bill settlements: real money movement, but not
  // confidently categorizable automatically. Flag for a human decision.
  const reviewThreads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"Debit transaction alert" ("IMPS/P2A" OR "CreditCard Payment") ' +
      '-label:' + NEEDS_REVIEW_LABEL + ' -label:' + IGNORED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIgnoredAndFlaggedNoise: %s transfer/settlement threads to flag", reviewThreads.length);
  reviewThreads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      // Lazy "[^\n]*?by" is important: the sentence ends with a disclaimer
      // ("...if the transaction has not been initiated by you.") — a greedy
      // match would jump to that LAST "by" instead of the transaction's own
      // "by IMPS/P2A/..." / "by CreditCard Payment..." clause.
      const match = body.match(/debited with INR ([\d,.]+) on (\d{2}-\d{2}-\d{2,4})[^\n]*?by ([^\n.]+)/);
      if (!match) return;
      appendNeedsReview_(normalizeAxisDate_(match[2]), "Axis Bank", match[3].trim(), parseAmount_(match[1]), message,
        "Large transfer or card-bill settlement — confirm purpose before categorizing");
    });
    thread.addLabel(needsReview);
  });
}

// --- Entry point -------------------------------------------------------------

function runSpendSenseSync() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("runSpendSenseSync: bound to spreadsheet '%s' (%s)", ss.getName(), ss.getId());
  if (!ss.getSheetByName(INVOICES_SHEET)) {
    Logger.log("ERROR: no sheet tab named '%s' found in this spreadsheet — check INVOICES_SHEET constant / tab name", INVOICES_SHEET);
    return;
  }

  const sources = [
    processInstamartOrders,
    processSwiggyDiningOrders,
    processIciciCardAlerts,
    processAxisUpiBillPayments,
    processAxisRecurringDebits,
    processRedBusTickets,
    processIrctcBookings,
    processAxisMyZoneTransactions,
    processAxisNeoRupayTransactions,
    processScapiaTransactions,
    processIgnoredAndFlaggedNoise,
  ];

  const startTime = Date.now();
  for (const fn of sources) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      Logger.log("runSpendSenseSync: time budget used up, stopping before %s (will resume next run)", fn.name);
      break;
    }
    try {
      fn();
    } catch (e) {
      Logger.log("ERROR in %s: %s", fn.name, e.message);
    }
  }

  Logger.log("runSpendSenseSync: done (%s ms elapsed)", Date.now() - startTime);

  try {
    checkBudgetAlerts();
  } catch (e) {
    Logger.log("ERROR in checkBudgetAlerts: %s", e.message);
  }
}

// TEMPORARY — run this ONCE after a parsing-logic fix, to let previously
// mislabeled threads be retried. Clears the Needs_Review sheet rows and
// removes the NeedsReview Gmail label from every thread that has it (leaves
// Processed/Ignored labels alone — only re-opens what was flagged for review).
function resetNeedsReview() {
  const sheet = getOrCreateNeedsReviewSheet_();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  const label = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = label.getThreads();
  threads.forEach((thread) => thread.removeLabel(label));
  Logger.log("resetNeedsReview: cleared sheet rows and un-flagged %s threads", threads.length);
}

// TEMPORARY — run this ONCE to recover from the date-corruption bug: it
// un-marks every Instamart thread as Processed so they're retried with the
// fixed date-writing code. Safe to run even for orders outside the 6-month
// DATE_FILTER window — those simply won't be found again, so nothing is
// re-added for them (delete their corrupted rows from Invoices_Raw first).
function resetInstamartProcessed() {
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'subject:"Instamart order was successfully delivered" label:' + PROCESSED_LABEL
  );
  threads.forEach((thread) => thread.removeLabel(label));
  Logger.log("resetInstamartProcessed: un-flagged %s threads", threads.length);
}

// TEMPORARY — recovers from the "independent date search grabbed the wrong
// date from footer boilerplate" bug in processIciciCardAlerts: these 14
// specific messages got wrong (2022-2023) dates, whose rows were already
// deleted from the sheet, but they're still marked Processed so they'd never
// retry. Un-flags exactly these so the next runSpendSenseSync picks them up
// again with the now-fixed date regex.
function resetSpecificMessages() {
  const label = getOrCreateLabel_(PROCESSED_LABEL);
  const messageIds = [
    "189884eaeef9c4b6", "1895ec75f62326b0", "1895952d086f07f3", "188f7a81fa9ea4d4",
    "1884488405e7f5b4", "18805a2f0f8d9bd1", "1874d64e40f6419a", "1871c2e8fd22f3b0",
    "186d552de759cc21", "186720bf7c7bc8ce", "185e2335e0f20776", "185b03659958d61b",
    "185a1b96731b17c3", "185690a875ab00b1",
  ];
  let count = 0;
  messageIds.forEach((id) => {
    try {
      GmailApp.getMessageById(id).getThread().removeLabel(label);
      count++;
    } catch (e) {
      Logger.log("Could not un-flag message %s: %s", id, e.message);
    }
  });
  Logger.log("resetSpecificMessages: un-flagged %s of %s messages", count, messageIds.length);
}

// TEMPORARY DIAGNOSTIC — run this once, then tell Claude it's done. Writes
// full raw email bodies into a "Debug" sheet tab (Logger.log truncates long
// entries, a sheet cell doesn't) so the real text format can be inspected
// directly. Delete this function and the Debug tab once parsing is fixed.
function debugDumpSampleBodies() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Debug");
  if (!sheet) sheet = ss.insertSheet("Debug");
  sheet.clear();

  const samples = [
    ["Scapia transaction", 'from:scapiacards@federalbank.co.in subject:"Your transaction was successful"'],
    ["Axis My Zone transaction", 'from:alerts@axis.bank.in subject:"spent on credit card no. XX5085"'],
  ];

  let row = 1;
  samples.forEach(([label, query]) => {
    const threads = GmailApp.search(query, 0, 1);
    const body = threads.length > 0 ? threads[0].getMessages()[0].getPlainBody() : "(no matching thread found)";
    sheet.getRange(row, 1).setValue(label);
    sheet.getRange(row, 2).setValue(body);
    row++;
  });

  Logger.log("Wrote %s sample bodies to the 'Debug' tab.", samples.length);
}

// --- Budget threshold email alerts ------------------------------------------

const BUDGET_ALERT_THRESHOLD = 0.9;
const BUDGETS_SHEET = "Budgets";
const BUDGET_ALERTS_SENT_SHEET = "Budget_Alerts_Sent";

const inr_ = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function formatCategoryLabel_(category) {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getOrCreateAlertsSentSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(BUDGET_ALERTS_SENT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(BUDGET_ALERTS_SENT_SHEET);
    sheet.appendRow(["Category", "Month", "SentAt"]);
  }
  return sheet;
}

/**
 * Emails you (the account this script is authorized under) once per
 * category per month, the first time that category's spend reaches 90% of
 * its Budgets-tab target. Run on the same daily trigger as the sync so it
 * checks fresh data. Needs the Gmail send scope — re-run runSpendSenseSync
 * once manually after pasting this in to accept the new authorization
 * prompt (Apps Script asks again whenever a script requests a new scope).
 */
function checkBudgetAlerts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const budgetsSheet = ss.getSheetByName(BUDGETS_SHEET);
  const invoicesSheet = getInvoicesSheet_();
  if (!budgetsSheet || !invoicesSheet) {
    Logger.log("checkBudgetAlerts: missing Budgets or Invoices_Raw sheet, skipping");
    return;
  }

  const budgetRows = budgetsSheet.getDataRange().getValues().slice(1); // skip header
  const targets = new Map();
  budgetRows.forEach(([category, target]) => {
    if (category && target > 0) targets.set(String(category), Number(target));
  });
  if (targets.size === 0) {
    Logger.log("checkBudgetAlerts: no budget targets set, skipping");
    return;
  }

  const now = new Date();
  const monthKey = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM");
  const invoiceRows = invoicesSheet.getDataRange().getValues().slice(1);

  const spendByCategory = new Map();
  invoiceRows.forEach((row) => {
    const [dateStr, , , , category, amount, fee] = row;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return;
    const rowMonthKey = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM");
    if (rowMonthKey !== monthKey) return;
    const total = (Number(amount) || 0) + (Number(fee) || 0);
    spendByCategory.set(category, (spendByCategory.get(category) || 0) + total);
  });

  const alertsSheet = getOrCreateAlertsSentSheet_();
  const alreadySent = new Set(
    alertsSheet.getDataRange().getValues().slice(1).map(([category, month]) => `${category}|${month}`)
  );

  const recipient = Session.getActiveUser().getEmail();
  let sentCount = 0;

  targets.forEach((target, category) => {
    const spend = spendByCategory.get(category) || 0;
    const pct = spend / target;
    const key = `${category}|${monthKey}`;
    if (pct < BUDGET_ALERT_THRESHOLD || alreadySent.has(key)) return;

    const label = formatCategoryLabel_(category);
    const subject = `SpendSense: ${label} at ${Math.round(pct * 100)}% of budget`;
    const body =
      `Your "${label}" spend this month is ${inr_.format(spend)}, ` +
      `which is ${Math.round(pct * 100)}% of your ${inr_.format(target)} monthly target.\n\n` +
      `Check the budget page for details.`;

    MailApp.sendEmail(recipient, subject, body);
    alertsSheet.appendRow([category, monthKey, new Date()]);
    alreadySent.add(key);
    sentCount++;
  });

  Logger.log("checkBudgetAlerts: sent %s alert(s) for %s", sentCount, monthKey);
}

function createDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "runSpendSenseSync")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("runSpendSenseSync")
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();
}
