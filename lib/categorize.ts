import { Category } from "./types";

// Mirrors ITEM_CATEGORY_RULES in apps-script/Code.gs — kept in sync manually
// since the Apps Script runtime and this Next.js app don't share a module.
// Checked in order; first match wins. Snacks/personal_care/household go
// first since branded packaged-goods names often contain a raw-ingredient
// word as a flavor descriptor (e.g. "No Palm Oil" snacks) that would
// otherwise false-match the raw-ingredient categories below.
const ITEM_CATEGORY_RULES: [Category, string[]][] = [
  ["snacks", ["chips", "biscuit", "chocolate", "cookie", "wafer", "ice cream", "gelato",
    "cola", "soda", "soft drink", "ginger ale", "namkeen", "chakli", "coffee", "drink",
    "cadbury", "makhana", "dairy milk"]],
  ["personal_care", ["shampoo", "soap", "sunscreen", "face wash", "body wash", "conditioner",
    "lotion", "period", "panties", "skincare", "glow"]],
  ["household", ["detergent", "dettol", "cleaner", "tissue", "paper towel", "antiseptic"]],
  ["meat_seafood", ["chicken curry", "mutton", "fish", "prawn", "seafood", "curry cut", "boneless"]],
  ["dairy_eggs", ["milk", "curd", "paneer", "buttermilk", "ghee", "cheese", "yogurt", "egg"]],
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

export function categorizeGroceryItem(name: string): Category {
  if (!name) return "other";
  const lower = name.toLowerCase();
  for (const [category, keywords] of ITEM_CATEGORY_RULES) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "other";
}
