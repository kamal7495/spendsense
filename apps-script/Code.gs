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
const INCOME_SHEET = "Income_Raw";
const NEEDS_REVIEW_SHEET = "Needs_Review";
const PROCESSED_LABEL = "SpendSense/Processed";
const IGNORED_LABEL = "SpendSense/Ignored";
const NEEDS_REVIEW_LABEL = "SpendSense/NeedsReview";

// Fixed start date rather than a rolling window, per the user: hold data
// from 1 Jan 2026 onward only, indefinitely — not "the last N months",
// which would silently roll old months off as time passes. Gmail's
// after:YYYY/MM/DD syntax is inclusive of that date.
const DATE_FILTER = "after:2026/01/01";

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

function getOrCreateIncomeSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INCOME_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INCOME_SHEET);
    sheet.appendRow(["Date", "Source", "Description", "Amount"]);
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

function appendIncomeRow_(date, source, description, amount) {
  const sheet = getOrCreateIncomeSheet_();
  sheet.appendRow([date, source, description, amount]);
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
  ["shopping", ["amazon", "asspl", "flipkart", "myntra", "blink comme", "blinkit", "zudio"]],
  ["transport", ["rapido", "uber", "ola cabs", "olacabs", "metro", "bmrcl", "cmrl",
    "redbus", "irctc"]],
  ["utilities", ["tnpdcl", "electricity", "bescom", "water board", "gas",
    "broadband", "airtel", "jio", "vodafone", "vi recharge"]],
  ["dining_out", ["starbucks"]],
  ["travel", ["makemytrip", "make my trip", "goibibo", "yatra"]],
  ["health", ["apollo pharm"]],
  ["entertainment", ["bookmyshow"]],
  ["personal_care", ["aadhvik", "vurve corp"]],
  // Car service/maintenance, not a ride fare — kept out of "transport" so it
  // doesn't blend with Rapido/Uber/metro-style commute costs.
  ["other", ["volkswagen"]],
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

// Amazon orders are itemized via processAmazonOrders, but that runs under a
// DIFFERENT Google account (confirmed by the user) whose sync may not be set
// up yet — unlike the Swiggy/Instamart case above, this isn't flagged as a
// certain duplicate to skip silently, since doing so could silently drop
// real spend if that other account's sync isn't running. Routed to
// Needs_Review instead, so nothing goes unrecorded either way.
const AMAZON_MERCHANT_KEYWORDS = ["amazon", "asspl"];

function isPossibleAmazonDuplicate_(merchant) {
  const lower = merchant.toLowerCase();
  return AMAZON_MERCHANT_KEYWORDS.some((k) => lower.includes(k));
}

function categorizeCardMerchant_(merchant) {
  const lower = merchant.toLowerCase();
  for (const [category, keywords] of CARD_MERCHANT_CATEGORY_RULES) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return null; // unrecognized merchant -> Needs_Review, not a guess
}

// JioFiber is billed to this card and already itemized by
// processJioFiberBills (reading Jio's own confirmation email) — recording it
// again here would double-count. Confirmed by the user: the ₹1,178.82 charge
// shows up under several different Reliance-family merchant strings
// (RELIANCE JIO INFOCOMM, MYJIO, RELIANCEJIO, and even the generic
// "RELIANCE RETAIL LIMITE", which doesn't contain "jio" as text at all) —
// so this is matched by the exact amount rather than broadening the merchant
// keyword, since "Reliance Retail" alone is far too generic a string to
// safely match (it's also used for unrelated Reliance Retail purchases).
const JIOFIBER_CARD_CHARGE_AMOUNT = 1178.82;

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

      if (amount === JIOFIBER_CARD_CHARGE_AMOUNT) {
        message.getThread().addLabel(processed); // known duplicate of processJioFiberBills — skip silently
        return;
      }
      if (isPossibleAmazonDuplicate_(merchant)) {
        appendNeedsReview_(date, "ICICI Bank Credit Card", merchant, amount, message,
          "Possible duplicate of an itemized Amazon order captured via the other account — confirm once that sync is set up");
        message.getThread().addLabel(needsReview);
        return;
      }

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

// --- Source 5: known recurring debits (insurance, home loan EMI, etc.) ------

// Each entry's item/category is a confirmed real-world label (not a guess),
// matched against the ACH narration text in the alert body. A narration that
// doesn't match any of these still falls through to
// processIgnoredAndFlaggedNoise's generic review-flagging.
const KNOWN_RECURRING_DEBITS = [
  { keyword: "ACH-DR-HDFCLifeInsuranceCo", item: "Life insurance premium (HDFC Life)", category: "other" },
  // Confirmed by the user: recurring ~₹66,864/month via "ACH-DR-HDFC BANK
  // LTD-<serial>" (the serial changes every month, so only the fixed prefix
  // is searched/matched).
  { keyword: "ACH-DR-HDFC BANK LTD", item: "Home loan EMI (HDFC Bank)", category: "other" },
];

function processAxisRecurringDebits() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const subjectQuery = KNOWN_RECURRING_DEBITS.map((d) => `"${d.keyword}"`).join(" OR ");
  const threads = GmailApp.search(
    `from:alerts@axis.bank.in subject:"Debit transaction alert" (${subjectQuery}) -label:` +
      PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisRecurringDebits: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const match = body.match(/debited with INR ([\d,.]+) on (\d{2}-\d{2}-\d{2,4})/);
      if (!match) return;

      const known = KNOWN_RECURRING_DEBITS.find((d) => body.includes(d.keyword));
      if (!known) return; // shouldn't happen given the search query, but stay safe

      const amount = parseAmount_(match[1]);
      const date = normalizeAxisDate_(match[2]);

      appendInvoiceRow_(date, "Axis Bank", "AXIS-ACH-" + message.getId(), known.item, known.category, amount, 0);
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
      if (isPossibleAmazonDuplicate_(merchant)) {
        appendNeedsReview_(date, "Axis My Zone (XX85)", merchant, amount, message,
          "Possible duplicate of an itemized Amazon order captured via the other account — confirm once that sync is set up");
        message.getThread().addLabel(needsReview);
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
      if (isPossibleAmazonDuplicate_(merchant)) {
        appendNeedsReview_(date, "Axis Neo Rupay (XX82)", merchant, amount, message,
          "Possible duplicate of an itemized Amazon order captured via the other account — confirm once that sync is set up");
        message.getThread().addLabel(needsReview);
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

      if (isPossibleAmazonDuplicate_(merchant)) {
        appendNeedsReview_(date, "Federal Bank (Scapia Card)", merchant, amount, message,
          "Possible duplicate of an itemized Amazon order captured via the other account — confirm once that sync is set up");
        message.getThread().addLabel(needsReview);
        return;
      }

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

// --- Source 11: Jio Fiber broadband recharges (utilities) -------------------

// Direct recharge-confirmation email from Jio itself, like RedBus/IRCTC —
// not a bank alert. The same amount also shows up as a generic "INR X was
// debited from your A/c" UPI alert, a format this pipeline doesn't parse at
// all yet (confirmed against real data: a ₹1,178.82 JioFiber recharge and a
// same-day, same-amount UPI debit alert both exist for 10-Aug-2026). If a
// future source starts parsing that generic UPI-debit format, it MUST skip
// merchants matching "jio"/"jiofiber" to avoid double-counting this one.
function processJioFiberBills() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:notifications_jiofiber@jio.com subject:"Recharge successful for JioFiber connection" -label:' +
      PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processJioFiberBills: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Recharge of Rs\.([\d,.]+) is successful/i);
      const txnMatch = body.match(/Transaction ID\s*:\s*([A-Za-z0-9]+)/i);
      if (!amountMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const orderId = txnMatch ? txnMatch[1] : message.getId();
      const date = toIsoDate_(message.getDate());

      appendInvoiceRow_(date, "Jio", "JIO-" + orderId, "JioFiber recharge", "utilities", amount, 0);
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 12: Axis savings account UPI transactions (unrecognized) --------

// A distinct alert format from the "Debit transaction alert for Axis Bank
// A/c" template used elsewhere in this file: subject "INR X was debited from
// your A/c no. XX3447.", body fields "Amount Debited:" / "Transaction Info:".
// Confirmed real gap: UPI/P2M (merchant) and UPI/P2A (person-to-person)
// purchases straight from the savings account weren't captured by any
// source at all — cross-checked against a real cashbook export, this
// accounted for real spend (daily food, fuel) with zero visibility here.
//
// Deliberately does NOT try to auto-categorize: confirmed against real data
// that the "merchant" in UPI/P2M often renders as a personal name (e.g.
// "SHOJAN K R" for what was actually a restaurant bill), not a business
// name — there's no reliable keyword to categorize by, so guessing here
// would mean guessing wrong often. Every transaction goes to Needs_Review
// instead, split into P2A/P2M/other so the reason at least says which.
function processAxisSavingsUpiTransactions() {
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"was debited from your A/c" -label:' + PROCESSED_LABEL +
      ' -label:' + NEEDS_REVIEW_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAxisSavingsUpiTransactions: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const amountMatch = body.match(/Amount Debited:\s*\n*\s*INR\s*([\d,.]+)/i);
      const infoMatch = body.match(/Transaction Info:\s*\n*\s*(UPI\/[^\n]+)/i);
      if (!amountMatch || !infoMatch) return;

      const amount = parseAmount_(amountMatch[1]);
      const info = infoMatch[1].trim();
      const date = toIsoDate_(message.getDate());

      // Already captured via processJioFiberBills (Jio's own confirmation
      // email) — this UPI debit is the same recharge, seen from the bank
      // side instead. Recording it here too would double-count.
      if (amount === JIOFIBER_CARD_CHARGE_AMOUNT) {
        message.getThread().addLabel(processed);
        return;
      }

      const reason = /^UPI\/P2A\//i.test(info)
        ? "UPI person-to-person transfer — confirm purpose before categorizing"
        : /^UPI\/P2M\//i.test(info)
          ? "UPI merchant payment — pick a category (payee names here are often personal, not business, names)"
          : "Unrecognized UPI transaction type — pick a category";

      appendNeedsReview_(date, "Axis Bank", info, amount, message, reason);
      message.getThread().addLabel(needsReview);
    });
  });
}

// --- Source 13: Salary credits (income) --------------------------------------

// Axis sends a "Credit transaction alert" for EVERY credit to the savings
// account (small P2P transfers, refunds, interest, salary — all the same
// subject line). Verified against real emails that the monthly salary
// credit is a NEFT whose narration ends in "/Sala" (the narration field
// truncates "Salary" mid-word: e.g. "NEFT/IN22626825782262/Sala."). Only
// that pattern is recorded as income; every other credit on this subject
// is out of scope for this source (not income — a P2P transfer or refund)
// and is marked processed so it isn't rescanned indefinitely.
function processSalaryCredits() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"Credit transaction alert for Axis Bank A/c" -label:' +
      PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processSalaryCredits: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const match = body.match(/credited with INR\s*([\d,.]+)\s*on\s*(\d{2}-\d{2}-\d{2,4})[^\n]*?by\s+([^\n.]+)\./);
      if (!match) return;

      const narration = match[3].trim();
      if (!/\/Sala$/i.test(narration)) {
        // Not a salary credit (P2P transfer, refund, interest, etc.) — out of
        // scope for income tracking, and not spend either, so nothing to log.
        message.getThread().addLabel(processed);
        return;
      }

      const amount = parseAmount_(match[1]);
      const date = normalizeAxisDate_(match[2]);
      appendIncomeRow_(date, "Salary (Axis Bank)", narration, amount);
      message.getThread().addLabel(processed);
    });
  });
}

// --- Source 15: Amazon order confirmations (shopping) -----------------------

// Lives in a different Google account than the one this script is usually
// run from (confirmed by the user) — harmless to include in the shared
// source list regardless of which account runs it, since the search simply
// finds nothing in an account that never receives these.
//
// Each "Ordered:" email is a DIGEST that can bundle multiple distinct Amazon
// orders (different Order #s, one per shipment/seller) together. Per-item
// prices in the plain-text rendering are unreliable — they render with no
// decimal point and don't sum to the order's own total (a real observed
// case: item prices 68900/99800/41900/18900 for an order whose actual Total
// was ₹2,607.35 — no consistent scale reconciles them). Only the per-order
// "Total ₹X" line is trustworthy, so this records ONE row per Order # (not
// per item), joining the item names together for visibility into what was
// actually bought without guessing at a per-item price split.
function processAmazonOrders() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const threads = GmailApp.search(
    'from:auto-confirm@amazon.in subject:"Ordered:" -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processAmazonOrders: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const date = toIsoDate_(message.getDate());
      const segments = body.split(/Order #/).slice(1); // first chunk is preamble before any order
      if (segments.length === 0) return; // not an order-confirmation shaped email; retry next run

      let wroteSomething = false;
      segments.forEach((seg) => {
        // Real template (verified against 5 actual emails via
        // debugDumpAmazonFailures — a FORWARDED sample looked different, with
        // "[image: ...]" markup and "Total ₹X" on one line, but that turned
        // out to be a rendering artifact of forwarding itself, not what
        // getPlainBody() ever actually returns): order number on its own
        // line after "Order #", each item as "* <name>\n  Quantity: N\n
        // NNN INR", and "Total\nNNN INR" with the label and amount on
        // separate lines, no ₹ symbol.
        const orderIdMatch = seg.match(/^\s*(\d{3}-\d{7}-\d{7})/);
        const totalMatch = seg.match(/Total\s*\n\s*([\d,.]+)\s*INR/);
        if (!orderIdMatch || !totalMatch) {
          appendNeedsReview_(
            date, "Amazon", "Order segment didn't match parser format", "", message,
            "Different email template — parser couldn't find an order number/total in this section"
          );
          message.getThread().addLabel(needsReview);
          return;
        }

        const amount = parseAmount_(totalMatch[1]);
        if (!amount) return; // ₹0 orders exist (e.g. a bundled free installation service) - nothing to record

        // Bound item extraction to this order's own Total line so a
        // multi-order digest doesn't bleed one order's items into another's.
        const itemsSection = seg.slice(0, totalMatch.index + totalMatch[0].length);
        const itemMatches = [...itemsSection.matchAll(/\*\s+([\s\S]+?)\n\s*Quantity:\s*(\d+)/g)]
          .map((m) => ({ name: m[1].replace(/\s+/g, " ").trim(), qty: m[2] }));

        const itemLabel =
          itemMatches.length <= 1
            ? (itemMatches[0] && itemMatches[0].name) || "Amazon order"
            : itemMatches
                .map(({ name, qty }) => `${name.slice(0, 40)}${name.length > 40 ? "…" : ""} (x${qty})`)
                .join("; ");

        appendInvoiceRow_(date, "Amazon", orderIdMatch[1], itemLabel, "shopping", amount, 0);
        wroteSomething = true;
      });

      if (wroteSomething) message.getThread().addLabel(processed);
    });
  });
}

// --- Source 16: Coin by Zerodha SIP mutual fund allotments (investments) ----

// Each email is a consolidated allotment report covering one or more funds
// bought that cycle. The email is HTML with a markdown-style table; the
// Gmail API's own plain-text rendering keeps "| Fund ... | Amount |" rows,
// but GmailApp.getPlainBody() strips every "|" and instead reflows each
// table cell onto its own line (confirmed against real emails — same class
// of renderer mismatch that broke the Amazon order parser). Whether the
// fund name lands on its own line before "Folio no.:" or stays on the same
// line depends on name length, and the amount is sometimes a whole rupee
// figure with no decimal point at all (e.g. "₹59997") — so this parses by
// chunking on each entry's trailing "<units> units" marker instead of
// anchoring to a specific line layout, which is robust to both.
// Tracked under the "investments" category, which is deliberately excluded
// from the This month/Last month spend totals (see lib/analytics.ts) since
// it's money moved into savings, not consumed.
function parseZerodhaAllotments_(body) {
  const afterHeader = body.split(/Allotment success|Purchase confirmation/)[1];
  if (!afterHeader) return [];

  const chunks = afterHeader.split(/[\d,]+\.\d+\s*units/);
  const entryChunks = chunks.slice(0, -1); // last chunk is trailing footer text, not an entry

  const rows = [];
  entryChunks.forEach((chunk) => {
    const folioIdx = chunk.indexOf("Folio no.:");
    if (folioIdx === -1) return;

    let fund = chunk.slice(0, folioIdx).replace(/^\s*Fund\s*Amount\s*/i, "").trim();
    fund = fund.replace(/\s*\n\s*/g, " ").trim();

    // The last ₹ amount in the chunk is the actual invested amount - NAV and
    // Stamp Duty (both also ₹-prefixed) always appear earlier in the chunk.
    const amountMatches = [...chunk.matchAll(/₹([\d,]+(?:\.\d+)?)/g)];
    if (amountMatches.length === 0) return;
    const amount = parseAmount_(amountMatches[amountMatches.length - 1][1]);

    if (fund && Number.isFinite(amount) && amount > 0) rows.push({ fund, amount });
  });

  return rows;
}

function processZerodhaSipInvestments() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:noreply-coin@qmailer.zerodha.net subject:"Coin by Zerodha - Allotment report" -label:' +
      PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processZerodhaSipInvestments: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const date = toIsoDate_(message.getDate());
      const rows = parseZerodhaAllotments_(body);

      rows.forEach((row, i) => {
        appendInvoiceRow_(date, "Coin by Zerodha", "ZERODHA-" + message.getId() + "-" + i, row.fund, "investments", row.amount, 0);
      });

      if (rows.length > 0) {
        message.getThread().addLabel(processed);
      }
    });
  });
}

// --- Source 17: Coin by Zerodha SIP mutual fund redemptions (investments) ---

// A redemption withdraws money OUT of a fund back to the bank account - the
// reverse of an allotment. Recorded as a NEGATIVE amount under the same
// "investments" category (not a new category or Income_Raw) so it nets
// against contributions in any investments total: net invested = SIP
// contributions minus redemptions, without a separate concept to track.
// Real emails confirmed to have a different shape than allotments - no
// "Folio no.:" at all, instead "<fund name> NAV: ₹<nav>" - plus a trailing
// disclaimer row ("Amount will be credited directly to your bank account...")
// that must NOT be mistaken for a fund entry; it has no "NAV:" or "<units>
// units" marker, so it's naturally excluded rather than needing a special
// case.
function parseZerodhaRedemptions_(body) {
  const afterHeader = body.split(/Redemption success/)[1];
  if (!afterHeader) return [];

  const chunks = afterHeader.split(/[\d,]+\.\d+\s*units/);
  const entryChunks = chunks.slice(0, -1); // last chunk is trailing footer/disclaimer text

  const rows = [];
  entryChunks.forEach((chunk) => {
    const navIdx = chunk.indexOf("NAV:");
    if (navIdx === -1) return;

    let fund = chunk.slice(0, navIdx).replace(/^\s*Fund\s*Amount\s*/i, "").trim();
    fund = fund.replace(/\s*\n\s*/g, " ").trim();

    const amountMatches = [...chunk.matchAll(/₹([\d,]+(?:\.\d+)?)/g)];
    if (amountMatches.length === 0) return;
    const amount = parseAmount_(amountMatches[amountMatches.length - 1][1]);

    if (fund && Number.isFinite(amount) && amount > 0) rows.push({ fund, amount });
  });

  return rows;
}

function processZerodhaSipRedemptions() {
  const processed = getOrCreateLabel_(PROCESSED_LABEL);
  const threads = GmailApp.search(
    'from:noreply-coin@qmailer.zerodha.net subject:"Coin by Zerodha - Redemption report" -label:' +
      PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processZerodhaSipRedemptions: %s matching threads", threads.length);

  threads.forEach((thread) => {
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      const date = toIsoDate_(message.getDate());
      const rows = parseZerodhaRedemptions_(body);

      rows.forEach((row, i) => {
        appendInvoiceRow_(
          date, "Coin by Zerodha", "ZERODHA-REDEEM-" + message.getId() + "-" + i,
          row.fund + " (redemption)", "investments", -row.amount, 0
        );
      });

      if (rows.length > 0) {
        message.getThread().addLabel(processed);
      }
    });
  });
}

// --- Explicitly ignored: marketing, OTPs, incoming credits, card-bill ------
// settlements (would double-count spend already captured via the card-
// transaction alerts above), and large P2A/IMPS transfers (ambiguous
// purpose — flagged for manual review instead of guessed at).

// Known fixed-amount IMPS/P2A transfers whose purpose has been confirmed,
// matched by exact amount since the narration carries no merchant/purpose
// text to key off. Recorded directly instead of going to Needs_Review; any
// other amount still gets flagged.
const KNOWN_IMPS_TRANSFERS = [
  { amount: 27000, item: "Car loan payment (ICICI)", category: "other" },
  // SBI -> Mutual Funds SIP, confirmed against a Money Manager cashbook
  // export ("SBI -> Mutual Funds", note "July month"). The actual SIP debit
  // happens on the SBI side, which this pipeline doesn't have any Gmail
  // alerts for at all (SBI only sends monthly PDF statements, no
  // per-transaction alerts) — so this Axis-side transfer is really the
  // funding hop that feeds it, not the SIP purchase itself. Still
  // categorized as investments since the money's ultimate destination is
  // the same SIP, consistent with how the Zerodha SIP is tracked.
  { amount: 67870, item: "SIP funding transfer (SBI Mutual Fund)", category: "investments" },
];

function processIgnoredAndFlaggedNoise() {
  const ignored = getOrCreateLabel_(IGNORED_LABEL);
  const needsReview = getOrCreateLabel_(NEEDS_REVIEW_LABEL);
  const processed = getOrCreateLabel_(PROCESSED_LABEL);

  // Pure noise: never worth a row.
  const ignoreThreads = GmailApp.search(
    'subject:(OTP OR "activate upi" OR "upi fraud" OR "scapia coins" OR "upi stays free") ' +
      '-label:' + IGNORED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIgnoredAndFlaggedNoise: %s noise threads to ignore", ignoreThreads.length);
  ignoreThreads.forEach((thread) => thread.addLabel(ignored));

  // Large transfers / card-bill settlements: real money movement, mostly not
  // confidently categorizable automatically — flagged for a human decision,
  // except the recognized car-loan transfer above.
  const reviewThreads = GmailApp.search(
    'from:alerts@axis.bank.in subject:"Debit transaction alert" ("IMPS/P2A" OR "CreditCard Payment") ' +
      '-label:' + NEEDS_REVIEW_LABEL + ' -label:' + IGNORED_LABEL + ' -label:' + PROCESSED_LABEL + ' ' + DATE_FILTER,
    0, MAX_THREADS_PER_SOURCE
  );
  Logger.log("processIgnoredAndFlaggedNoise: %s transfer/settlement threads to review", reviewThreads.length);
  reviewThreads.forEach((thread) => {
    let flaggedAny = false;
    thread.getMessages().forEach((message) => {
      const body = message.getPlainBody();
      // Lazy "[^\n]*?by" is important: the sentence ends with a disclaimer
      // ("...if the transaction has not been initiated by you.") — a greedy
      // match would jump to that LAST "by" instead of the transaction's own
      // "by IMPS/P2A/..." / "by CreditCard Payment..." clause.
      const match = body.match(/debited with INR ([\d,.]+) on (\d{2}-\d{2}-\d{2,4})[^\n]*?by ([^\n.]+)/);
      if (!match) return;

      const amount = parseAmount_(match[1]);
      const date = normalizeAxisDate_(match[2]);
      const narration = match[3].trim();

      const known = /IMPS\/P2A/i.test(narration) && KNOWN_IMPS_TRANSFERS.find((t) => t.amount === amount);
      if (known) {
        appendInvoiceRow_(date, "Axis Bank", "AXIS-IMPS-" + message.getId(), known.item, known.category, amount, 0);
        message.getThread().addLabel(processed);
        return;
      }

      appendNeedsReview_(date, "Axis Bank", narration, amount, message,
        "Large transfer or card-bill settlement — confirm purpose before categorizing");
      flaggedAny = true;
    });
    if (flaggedAny) thread.addLabel(needsReview);
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
    processJioFiberBills,
    processSalaryCredits,
    processAmazonOrders,
    processZerodhaSipInvestments,
    processZerodhaSipRedemptions,
    processAxisSavingsUpiTransactions,
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

// TEMPORARY — run this ONCE from the Amazon-order account after a parsing
// fix to processAmazonOrders, to retry exactly the threads that got flagged
// under the OLD parser without touching the rest of the Needs_Review
// backlog. Deletes the matching sheet rows and un-flags just those Gmail
// threads (leaves every other Needs_Review row alone).
function resetAmazonNeedsReview() {
  const sheet = getOrCreateNeedsReviewSheet_();
  const data = sheet.getDataRange().getValues();
  const label = getOrCreateLabel_(NEEDS_REVIEW_LABEL);

  const rowsToDelete = [];
  let unflagged = 0;
  for (let i = 1; i < data.length; i++) {
    const [, vendor, description, , gmailLink] = data[i];
    if (vendor !== "Amazon" || description !== "Order segment didn't match parser format") continue;

    rowsToDelete.push(i + 1); // 1-indexed sheet row
    const messageId = gmailLink.split("/").pop();
    try {
      GmailApp.getMessageById(messageId).getThread().removeLabel(label);
      unflagged++;
    } catch (e) {
      Logger.log("Could not un-flag message %s: %s", messageId, e.message);
    }
  }

  rowsToDelete
    .sort((a, b) => b - a) // bottom-up so earlier deletes don't shift later indices
    .forEach((row) => sheet.deleteRow(row));

  Logger.log("resetAmazonNeedsReview: deleted %s rows, un-flagged %s threads", rowsToDelete.length, unflagged);
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
    ["Zerodha SIP allotment", 'from:noreply-coin@qmailer.zerodha.net subject:"Coin by Zerodha - Allotment report"'],
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

// TEMPORARY DIAGNOSTIC — run this from the Amazon-order account (not the
// main one), then tell Claude it's done. processAmazonOrders' regex only
// matches the ONE order-email shape it's been verified against so far, and
// real runs have flagged others as "Order segment didn't match parser
// format" — this pulls a few of those real bodies into the Debug tab (a
// sheet cell doesn't truncate long text the way Logger.log does) so the
// actual differing format can be inspected directly. Delete this function
// and clear the Debug tab once the parser handles them.
function debugDumpAmazonFailures() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Debug");
  if (!sheet) sheet = ss.insertSheet("Debug");
  sheet.clear();

  const needsReview = getOrCreateNeedsReviewSheet_();
  const rows = needsReview.getDataRange().getValues().slice(1); // skip header
  const failures = rows.filter(
    ([, vendor, description]) => vendor === "Amazon" && description === "Order segment didn't match parser format"
  );

  const MAX_SAMPLES = 5;
  const seen = new Set();
  let row = 1;
  let written = 0;
  for (const failureRow of failures) {
    if (written >= MAX_SAMPLES) break;
    const gmailLink = failureRow[4];
    const messageId = gmailLink.split("/").pop();
    if (seen.has(messageId)) continue; // one email can produce several flagged segments
    seen.add(messageId);

    let body;
    try {
      body = GmailApp.getMessageById(messageId).getPlainBody();
    } catch (e) {
      body = "(couldn't fetch message " + messageId + ": " + e.message + ")";
    }
    sheet.getRange(row, 1).setValue(messageId);
    sheet.getRange(row, 2).setValue(body);
    row++;
    written++;
  }

  Logger.log("debugDumpAmazonFailures: wrote %s sample bodies to the 'Debug' tab (out of %s flagged failures).", written, failures.length);
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
// Matches PAY_CYCLE_START_DAY / SALARY_DAY on the Next.js side
// (lib/payPeriod.ts, lib/cashflow.ts) — confirmed by the user: salary lands
// on the 25th, so the "budget month" a paycheck actually has to stretch
// across runs 25th-to-24th, not the calendar month. Keep both in sync if
// this ever changes.
const PAY_CYCLE_START_DAY = 25;

function getCurrentPayCycleBounds_(now) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const startMonth = d >= PAY_CYCLE_START_DAY ? m : m - 1;
  const start = new Date(y, startMonth, PAY_CYCLE_START_DAY);
  const end = new Date(y, startMonth + 1, PAY_CYCLE_START_DAY - 1, 23, 59, 59, 999);
  return { start, end };
}

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
  const { start: cycleStart, end: cycleEnd } = getCurrentPayCycleBounds_(now);
  const cycleKey = Utilities.formatDate(cycleStart, Session.getScriptTimeZone(), "yyyy-MM-dd");
  const invoiceRows = invoicesSheet.getDataRange().getValues().slice(1);

  const spendByCategory = new Map();
  invoiceRows.forEach((row) => {
    const [dateStr, , , , category, amount, fee] = row;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return;
    if (d < cycleStart || d > cycleEnd) return;
    const total = (Number(amount) || 0) + (Number(fee) || 0);
    spendByCategory.set(category, (spendByCategory.get(category) || 0) + total);
  });

  const alertsSheet = getOrCreateAlertsSentSheet_();
  const alreadySent = new Set(
    alertsSheet.getDataRange().getValues().slice(1).map(([category, cycle]) => `${category}|${cycle}`)
  );

  const recipient = Session.getActiveUser().getEmail();
  let sentCount = 0;

  targets.forEach((target, category) => {
    const spend = spendByCategory.get(category) || 0;
    const pct = spend / target;
    const key = `${category}|${cycleKey}`;
    if (pct < BUDGET_ALERT_THRESHOLD || alreadySent.has(key)) return;

    const label = formatCategoryLabel_(category);
    const subject = `SpendSense: ${label} at ${Math.round(pct * 100)}% of budget`;
    const body =
      `Your "${label}" spend this pay cycle (since ${cycleKey}) is ${inr_.format(spend)}, ` +
      `which is ${Math.round(pct * 100)}% of your ${inr_.format(target)} target.\n\n` +
      `Check the budget page for details.`;

    MailApp.sendEmail(recipient, subject, body);
    alertsSheet.appendRow([category, cycleKey, new Date()]);
    alreadySent.add(key);
    sentCount++;
  });

  Logger.log("checkBudgetAlerts: sent %s alert(s) for cycle starting %s", sentCount, cycleKey);
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
