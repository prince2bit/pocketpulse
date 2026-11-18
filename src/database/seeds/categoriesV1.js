// Starter categories and keywords, used by migration 2. This is a frozen snapshot:
// to change what existing users get, add a new migration (INSERT OR IGNORE keeps
// their own rules). Plurals are not listed because "chip" already matches "chips".
// Colours must exist in CATEGORY_COLORS.

export const CATEGORY_SEED = [
  {
    name: 'Food & Snacks', icon: '🍟', color: 'orange',
    keywords: ['chips', 'kurkure', 'lays', 'biscuits', 'cookies', 'chocolate', 'candy', 'namkeen',
      'popcorn', 'maggi', 'noodles', 'ice cream', 'icecream', 'cake', 'pastry', 'bhujia', 'wafers',
      'nachos', 'crackers', 'snack', 'dairy milk', 'kitkat', 'oreo', 'puff', 'sweets'],
  },
  {
    name: 'Food & Drinks', icon: '☕', color: 'yellow',
    keywords: ['chai', 'tea', 'coffee', 'samosa', 'juice', 'lassi', 'shake', 'milkshake', 'cold drink',
      'coke', 'pepsi', 'sprite', 'thums up', 'soda', 'water', 'lunch', 'dinner', 'breakfast', 'meal',
      'thali', 'pizza', 'burger', 'sandwich', 'dosa', 'idli', 'biryani', 'paratha', 'momos', 'pasta',
      'roll', 'vada pav', 'pav bhaji', 'pani puri', 'golgappa', 'canteen', 'mess', 'cafeteria',
      'zomato', 'swiggy', 'restaurant', 'dhaba', 'cafe', 'starbucks', 'dominos', 'mcdonalds',
      // Groceries live here too: PocketPulse has no separate Groceries category by default.
      // ("grocery" and "groceries" are both listed because "-ies" plurals don't reduce to "-y".)
      'groceries', 'grocery', 'vegetable', 'fruit', 'milk', 'bread', 'egg', 'rice', 'kirana',
      'supermarket', 'dmart', 'bigbasket', 'blinkit', 'zepto', 'instamart'],
  },
  {
    name: 'Transport', icon: '🚌', color: 'cyan',
    keywords: ['bus', 'train', 'metro', 'auto', 'rickshaw', 'cab', 'taxi', 'uber', 'ola', 'rapido',
      'petrol', 'diesel', 'fuel', 'parking', 'toll', 'bike', 'scooter', 'flight', 'ride', 'fare',
      'railway', 'irctc', 'bus pass', 'metro card', 'commute', 'local train'],
  },
  {
    name: 'College & Study', icon: '🎓', color: 'blue',
    keywords: ['notebook', 'pen', 'pencil', 'eraser', 'book', 'textbook', 'printing', 'print',
      'printout', 'xerox', 'photocopy', 'stationery', 'stationary', 'highlighter', 'marker',
      'calculator', 'tuition', 'coaching', 'fee', 'exam', 'library', 'lab', 'project', 'assignment',
      'folder', 'stapler', 'chart paper', 'notes', 'course', 'udemy', 'coursera', 'college'],
  },
  {
    name: 'Entertainment', icon: '🎬', color: 'magenta',
    keywords: ['movie', 'cinema', 'film', 'game', 'gaming', 'netflix', 'spotify', 'prime', 'hotstar',
      'youtube', 'streaming', 'concert', 'party', 'club', 'bowling', 'arcade', 'outing', 'steam',
      'playstation', 'ott', 'bookmyshow', 'pvr', 'inox', 'comic'],
  },
  {
    name: 'Shopping', icon: '👕', color: 'pink',
    keywords: ['clothes', 'clothing', 'shirt', 'tshirt', 'jeans', 'shoes', 'sneakers', 'slippers',
      'bag', 'backpack', 'amazon', 'flipkart', 'myntra', 'meesho', 'gift', 'watch', 'headphones',
      'earphones', 'charger', 'cable', 'phone case', 'accessories', 'jacket', 'hoodie', 'socks',
      'dress', 'kurta', 'water bottle', 'bottle'],
  },
  {
    name: 'Personal Care', icon: '🧴', color: 'teal',
    keywords: ['shampoo', 'soap', 'toothpaste', 'toothbrush', 'haircut', 'salon', 'barber', 'razor',
      'deodorant', 'deo', 'perfume', 'sanitizer', 'moisturizer', 'lotion', 'facewash', 'face wash',
      'sunscreen', 'hair oil', 'conditioner', 'trimmer', 'laundry', 'dhobi', 'tissues', 'comb',
      'body wash', 'cream'],
  },
  {
    name: 'Health', icon: '💊', color: 'red',
    keywords: ['medicine', 'tablet', 'pharmacy', 'chemist', 'doctor', 'hospital', 'clinic', 'vitamin',
      'checkup', 'dentist', 'eye drops', 'bandage', 'ors', 'paracetamol', 'crocin', 'syrup',
      'blood test', 'consultation', 'cough syrup', 'mask'],
  },
  {
    name: 'Bills & Recharge', icon: '📱', color: 'lime',
    keywords: ['recharge', 'mobile data', 'data pack', 'internet', 'wifi', 'broadband', 'electricity',
      'bill', 'rent', 'dth', 'postpaid', 'prepaid', 'jio', 'airtel', 'bsnl', 'phone bill',
      'water bill', 'gas cylinder', 'cylinder', 'maintenance'],
  },
  // The safety net: anything we can't match lands here. It can't be deleted.
  { name: 'Other', icon: '📦', color: 'grey', fallback: true, keywords: [] },
];
