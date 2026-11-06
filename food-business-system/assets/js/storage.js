/* =========================================================
   storage.js - LocalStorage preferences, raw ingredient seed
   data, local food/ingredient image maps & startup migration
   ========================================================= */
'use strict';

const Prefs = (() => {
  const KEY = 'fbs_prefs';
  const SESSION_KEY = 'fbs_session';
  const INGREDIENTS_LS_KEY = 'fbs_ingredients';
  const FALLBACK_IMAGE = 'assets/images/foods/placeholder-food.svg';
  const FALLBACK_INGREDIENT_IMAGE = 'assets/images/ingredients/placeholder-ingredient.svg';

  /* Local offline image catalog for finished menu items (Products & Sales) */
  const SEED_FOOD_IMAGES = {
    P001: 'assets/images/foods/classic-burger.jpg',
    P002: 'assets/images/foods/fries-large.jpg',
    P003: 'assets/images/foods/iced-tea.jpg',
    P004: 'assets/images/foods/cheese-pizza-slice.jpg',
    P005: 'assets/images/foods/chocolate-cake.jpg',
    P006: 'assets/images/foods/chicken-sandwich.jpg',
    P007: 'assets/images/foods/spaghetti.jpg',
    P008: 'assets/images/foods/fried-chicken.jpg',
    P009: 'assets/images/foods/milk-tea.jpg',
    P010: 'assets/images/foods/pancakes.jpg'
  };

  const SEED_NAME_IMAGES = {
    'classic burger': 'assets/images/foods/classic-burger.jpg',
    'fries large': 'assets/images/foods/fries-large.jpg',
    'iced tea': 'assets/images/foods/iced-tea.jpg',
    'cheese pizza slice': 'assets/images/foods/cheese-pizza-slice.jpg',
    'chocolate cake': 'assets/images/foods/chocolate-cake.jpg',
    'chicken sandwich': 'assets/images/foods/chicken-sandwich.jpg',
    'spaghetti': 'assets/images/foods/spaghetti.jpg',
    'fried chicken': 'assets/images/foods/fried-chicken.jpg',
    'milk tea': 'assets/images/foods/milk-tea.jpg',
    'pancakes': 'assets/images/foods/pancakes.jpg'
  };

  /* Local offline image catalog for raw kitchen ingredients (Inventory) */
  const SEED_INGREDIENT_IMAGES = {
    'ING-001': 'assets/images/ingredients/burger-buns.jpg',
    'ING-002': 'assets/images/ingredients/beef-patties.jpg',
    'ING-003': 'assets/images/ingredients/raw-chicken-cutlets.jpg',
    'ING-004': 'assets/images/ingredients/pizza-dough.jpg',
    'ING-005': 'assets/images/ingredients/mozzarella-cheese.jpg',
    'ING-006': 'assets/images/ingredients/fresh-potatoes.jpg',
    'ING-007': 'assets/images/ingredients/cooking-oil.jpg',
    'ING-008': 'assets/images/ingredients/all-purpose-flour.jpg',
    'ING-009': 'assets/images/ingredients/chocolate-frosting.jpg',
    'ING-010': 'assets/images/ingredients/fresh-milk.jpg',
    'ING-011': 'assets/images/ingredients/coffee-beans.jpg',
    'ING-012': 'assets/images/ingredients/takeout-packaging.jpg'
  };

  const SEED_INGREDIENT_NAME_IMAGES = {
    'burger buns': 'assets/images/ingredients/burger-buns.jpg',
    'beef patties': 'assets/images/ingredients/beef-patties.jpg',
    'raw chicken cutlets': 'assets/images/ingredients/raw-chicken-cutlets.jpg',
    'pizza dough': 'assets/images/ingredients/pizza-dough.jpg',
    'mozzarella cheese': 'assets/images/ingredients/mozzarella-cheese.jpg',
    'fresh potatoes': 'assets/images/ingredients/fresh-potatoes.jpg',
    'cooking oil': 'assets/images/ingredients/cooking-oil.jpg',
    'all-purpose flour': 'assets/images/ingredients/all-purpose-flour.jpg',
    'chocolate frosting': 'assets/images/ingredients/chocolate-frosting.jpg',
    'fresh milk': 'assets/images/ingredients/fresh-milk.jpg',
    'coffee beans': 'assets/images/ingredients/coffee-beans.jpg',
    'takeout packaging': 'assets/images/ingredients/takeout-packaging.jpg'
  };

  /* Raw Ingredient Categories for the Inventory Module */
  const INGREDIENT_CATEGORIES = [
    { id: 'INGCAT-01', name: 'Bakery & Grains', description: 'Buns, dough balls, flour and baking grains' },
    { id: 'INGCAT-02', name: 'Meat & Poultry', description: 'Raw beef patties, chicken cutlets and meats' },
    { id: 'INGCAT-03', name: 'Dairy & Eggs', description: 'Mozzarella cheese, fresh milk and butter' },
    { id: 'INGCAT-04', name: 'Produce & Vegetables', description: 'Fresh potatoes, lettuce, tomatoes and onions' },
    { id: 'INGCAT-05', name: 'Pantry & Oils', description: 'Cooking oil, seasonings and kitchen staples' },
    { id: 'INGCAT-06', name: 'Baking & Sweets', description: 'Chocolate frosting, syrups and dessert bases' },
    { id: 'INGCAT-07', name: 'Beverage Base', description: 'Coffee beans, tea leaves and tapioca pearls' },
    { id: 'INGCAT-08', name: 'Kitchen Supplies', description: 'Takeout boxes, cups and food packaging' }
  ];

  const defaults = {
    sidebarCollapsed: false,
    pageSize: 10,
    autoPrintReceipt: false,
    showPosImages: true,
    lowStockAlerts: true,
    expiryAlerts: true,
    productViewMode: 'grid',
    inventoryViewMode: 'grid',
    dashboardRange: '7',
    lastBackup: null
  };
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      cache = Object.assign({}, defaults, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) {
      console.warn('Preferences could not be read; using defaults.', e);
      cache = Object.assign({}, defaults);
    }
    return cache;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { console.warn('Preferences could not be saved.', e); }
  }

  /**
   * Builds the seed raw ingredients & kitchen supplies for the Inventory module,
   * complete with local image paths and multi-batch FEFO expiration dates.
   */
  function buildSeedIngredients(now = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const dateKey = d => {
      const x = new Date(d);
      return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    };
    const addDays = (d, n) => {
      const x = new Date(d);
      x.setDate(x.getDate() + n);
      return x;
    };
    const createdIso = addDays(now, -20).toISOString();
    const updatedIso = addDays(now, -1).toISOString();

    const specs = [
      {
        id: 'ING-001', name: 'Burger Buns', categoryId: 'INGCAT-01', categoryName: 'Bakery & Grains',
        unit: 'pack', cost: 65, price: 65, stock: 42, reorderLevel: 12, defaultShelfLifeDays: 6,
        description: 'Sesame seed brioche burger buns (12 pcs per pack).',
        image: SEED_INGREDIENT_IMAGES['ING-001'],
        batches: [
          { id: 'ING-001-B01', dateReceived: dateKey(addDays(now, -3)), expirationDate: dateKey(addDays(now, 4)), qty: 14, initialQty: 20, note: 'Golden Grain morning bake lot A' },
          { id: 'ING-001-B02', dateReceived: dateKey(addDays(now, -1)), expirationDate: dateKey(addDays(now, 9)), qty: 28, initialQty: 28, note: 'Golden Grain fresh delivery lot B' }
        ]
      },
      {
        id: 'ING-002', name: 'Beef Patties', categoryId: 'INGCAT-02', categoryName: 'Meat & Poultry',
        unit: 'kg', cost: 340, price: 340, stock: 28, reorderLevel: 10, defaultShelfLifeDays: 5,
        description: 'Chilled quarter-pound seasoned ground beef patties.',
        image: SEED_INGREDIENT_IMAGES['ING-002'],
        batches: [
          { id: 'ING-002-B01', dateReceived: dateKey(addDays(now, -4)), expirationDate: dateKey(addDays(now, 2)), qty: 10, initialQty: 15, note: 'Chilled beef patty tray A (use first)' },
          { id: 'ING-002-B02', dateReceived: dateKey(addDays(now, -1)), expirationDate: dateKey(addDays(now, 8)), qty: 18, initialQty: 18, note: 'Chilled beef patty tray B' }
        ]
      },
      {
        id: 'ING-003', name: 'Raw Chicken Cutlets', categoryId: 'INGCAT-02', categoryName: 'Meat & Poultry',
        unit: 'kg', cost: 245, price: 245, stock: 32, reorderLevel: 10, defaultShelfLifeDays: 5,
        description: 'Fresh boneless chicken breast and thigh fillets for frying and sandwiches.',
        image: SEED_INGREDIENT_IMAGES['ING-003'],
        batches: [
          { id: 'ING-003-B01', dateReceived: dateKey(addDays(now, -3)), expirationDate: dateKey(addDays(now, 5)), qty: 12, initialQty: 16, note: 'FreshFarm poultry crate 1' },
          { id: 'ING-003-B02', dateReceived: dateKey(addDays(now, -1)), expirationDate: dateKey(addDays(now, 10)), qty: 20, initialQty: 20, note: 'FreshFarm poultry crate 2' }
        ]
      },
      {
        id: 'ING-004', name: 'Pizza Dough', categoryId: 'INGCAT-01', categoryName: 'Bakery & Grains',
        unit: 'ball', cost: 48, price: 48, stock: 19, reorderLevel: 8, defaultShelfLifeDays: 4,
        description: 'Cold-fermented artisan pizza dough balls ready for stretching.',
        image: SEED_INGREDIENT_IMAGES['ING-004'],
        batches: [
          { id: 'ING-004-B01', dateReceived: dateKey(addDays(now, -6)), expirationDate: dateKey(addDays(now, -1)), qty: 3, initialQty: 10, note: 'Proofed dough tray (expired in walk-in)' },
          { id: 'ING-004-B02', dateReceived: dateKey(addDays(now, -1)), expirationDate: dateKey(addDays(now, 5)), qty: 16, initialQty: 16, note: 'Fresh dough batch B' }
        ]
      },
      {
        id: 'ING-005', name: 'Mozzarella Cheese', categoryId: 'INGCAT-03', categoryName: 'Dairy & Eggs',
        unit: 'block', cost: 290, price: 290, stock: 16, reorderLevel: 6, defaultShelfLifeDays: 14,
        description: 'Whole-milk mozzarella cheese blocks for pizza and pasta topping.',
        image: SEED_INGREDIENT_IMAGES['ING-005'],
        batches: [
          { id: 'ING-005-B01', dateReceived: dateKey(addDays(now, -8)), expirationDate: dateKey(addDays(now, 6)), qty: 6, initialQty: 10, note: 'Bella Italia dairy lot 1' },
          { id: 'ING-005-B02', dateReceived: dateKey(addDays(now, -2)), expirationDate: dateKey(addDays(now, 18)), qty: 10, initialQty: 10, note: 'Bella Italia dairy lot 2' }
        ]
      },
      {
        id: 'ING-006', name: 'Fresh Potatoes', categoryId: 'INGCAT-04', categoryName: 'Produce & Vegetables',
        unit: 'kg', cost: 78, price: 78, stock: 55, reorderLevel: 15, defaultShelfLifeDays: 21,
        description: 'Russet Burbank potatoes for hand-cut crispy fries.',
        image: SEED_INGREDIENT_IMAGES['ING-006'],
        batches: [
          { id: 'ING-006-B01', dateReceived: dateKey(addDays(now, -6)), expirationDate: dateKey(addDays(now, 15)), qty: 25, initialQty: 30, note: 'Prime Potato sack A' },
          { id: 'ING-006-B02', dateReceived: dateKey(addDays(now, -2)), expirationDate: dateKey(addDays(now, 24)), qty: 30, initialQty: 30, note: 'Prime Potato sack B' }
        ]
      },
      {
        id: 'ING-007', name: 'Cooking Oil', categoryId: 'INGCAT-05', categoryName: 'Pantry & Oils',
        unit: 'L', cost: 95, price: 95, stock: 36, reorderLevel: 10, defaultShelfLifeDays: 60,
        description: 'Pure high-smoke-point vegetable frying oil for deep fryers.',
        image: SEED_INGREDIENT_IMAGES['ING-007'],
        batches: [
          { id: 'ING-007-B01', dateReceived: dateKey(addDays(now, -10)), expirationDate: dateKey(addDays(now, 45)), qty: 36, initialQty: 40, note: 'Sealed 20L carboys' }
        ]
      },
      {
        id: 'ING-008', name: 'All-Purpose Flour', categoryId: 'INGCAT-01', categoryName: 'Bakery & Grains',
        unit: 'kg', cost: 58, price: 58, stock: 45, reorderLevel: 12, defaultShelfLifeDays: 45,
        description: 'Enriched wheat flour for chicken breading, pancakes and batters.',
        image: SEED_INGREDIENT_IMAGES['ING-008'],
        batches: [
          { id: 'ING-008-B01', dateReceived: dateKey(addDays(now, -9)), expirationDate: dateKey(addDays(now, 35)), qty: 45, initialQty: 50, note: 'Dry pantry bin 1' }
        ]
      },
      {
        id: 'ING-009', name: 'Chocolate Frosting', categoryId: 'INGCAT-06', categoryName: 'Baking & Sweets',
        unit: 'tub', cost: 185, price: 185, stock: 6, reorderLevel: 8, defaultShelfLifeDays: 7,
        description: 'Rich dark cocoa fudge frosting tub for layered chocolate cakes.',
        image: SEED_INGREDIENT_IMAGES['ING-009'],
        batches: [
          { id: 'ING-009-B01', dateReceived: dateKey(addDays(now, -5)), expirationDate: dateKey(addDays(now, 1)), qty: 6, initialQty: 12, note: 'Chilled pastry tub (expiring very soon)' }
        ]
      },
      {
        id: 'ING-010', name: 'Fresh Milk', categoryId: 'INGCAT-03', categoryName: 'Dairy & Eggs',
        unit: 'L', cost: 88, price: 88, stock: 22, reorderLevel: 10, defaultShelfLifeDays: 7,
        description: 'Pasteurized whole dairy milk for milk tea, batters and sauces.',
        image: SEED_INGREDIENT_IMAGES['ING-010'],
        batches: [
          { id: 'ING-010-B01', dateReceived: dateKey(addDays(now, -4)), expirationDate: dateKey(addDays(now, 2)), qty: 8, initialQty: 12, note: 'Chiller shelf A cartons' },
          { id: 'ING-010-B02', dateReceived: dateKey(addDays(now, -1)), expirationDate: dateKey(addDays(now, 6)), qty: 14, initialQty: 14, note: 'Chiller shelf B cartons' }
        ]
      },
      {
        id: 'ING-011', name: 'Coffee Beans', categoryId: 'INGCAT-07', categoryName: 'Beverage Base',
        unit: 'kg', cost: 410, price: 410, stock: 18, reorderLevel: 6, defaultShelfLifeDays: 30,
        description: 'Medium-dark roasted Arabica coffee beans and black tea blend.',
        image: SEED_INGREDIENT_IMAGES['ING-011'],
        batches: [
          { id: 'ING-011-B01', dateReceived: dateKey(addDays(now, -7)), expirationDate: dateKey(addDays(now, 22)), qty: 18, initialQty: 20, note: 'Airtight valve bags' }
        ]
      },
      {
        id: 'ING-012', name: 'Takeout Packaging', categoryId: 'INGCAT-08', categoryName: 'Kitchen Supplies',
        unit: 'bundle', cost: 160, price: 160, stock: 0, reorderLevel: 10, defaultShelfLifeDays: 365,
        description: 'Eco-friendly kraft burger boxes, 16oz cups and meal trays (50 pcs/bundle).',
        image: SEED_INGREDIENT_IMAGES['ING-012'],
        batches: []
      }
    ];

    return specs.map(s => ({
      ...s,
      isIngredient: true,
      status: 'active',
      createdAt: createdIso,
      updatedAt: updatedIso
    }));
  }

  /**
   * Returns the matching local photo path for either a finished food item (`assets/images/foods/...`)
   * or a raw ingredient (`assets/images/ingredients/...`).
   */
  function defaultFoodImage(productOrId, name = '') {
    if (!productOrId) return '';
    const isObj = typeof productOrId === 'object';
    const id = isObj ? String(productOrId.id || '').trim().toUpperCase() : String(productOrId).trim().toUpperCase();
    const nm = (isObj ? String(productOrId.name || '') : String(name || '')).trim().toLowerCase();

    if (id && SEED_INGREDIENT_IMAGES[id]) return SEED_INGREDIENT_IMAGES[id];
    if (nm && SEED_INGREDIENT_NAME_IMAGES[nm]) return SEED_INGREDIENT_NAME_IMAGES[nm];
    if (id && SEED_FOOD_IMAGES[id]) return SEED_FOOD_IMAGES[id];
    if (nm && SEED_NAME_IMAGES[nm]) return SEED_NAME_IMAGES[nm];
    return '';
  }

  /**
   * Safe startup migration:
   * 1. Populates and refreshes `localStorage` (`fbs_ingredients`) with raw ingredients and their local image paths.
   * 2. Updates IndexedDB `products` and `movements` stores so:
   *    - All 12 raw ingredients (`ING-001`..`ING-012`) exist with `isIngredient: true`, local ingredient photos, and FEFO batches.
   *    - All 10 finished menu items (`P001`..`P010`) have `isIngredient: false`, local food photos, and no expiration batches.
   */
  async function syncProductImages() {
    let updatedCount = 0;
    const now = new Date();
    const seedIngredients = buildSeedIngredients(now);

    // 1. Migrate & refresh LocalStorage raw ingredients + any cached lists
    try {
      const existingLsRaw = localStorage.getItem(INGREDIENTS_LS_KEY);
      let lsList = [];
      if (existingLsRaw) {
        try { lsList = JSON.parse(existingLsRaw); } catch (_) { lsList = []; }
      }
      if (!Array.isArray(lsList) || !lsList.length) {
        localStorage.setItem(INGREDIENTS_LS_KEY, JSON.stringify(seedIngredients));
      } else {
        const byId = new Map(lsList.map(x => [x.id, x]));
        seedIngredients.forEach(seed => {
          const cur = byId.get(seed.id);
          if (!cur) {
            lsList.push(seed);
          } else {
            cur.isIngredient = true;
            cur.image = cur.image || seed.image;
            cur.categoryId = cur.categoryId || seed.categoryId;
            cur.categoryName = cur.categoryName || seed.categoryName;
          }
        });
        localStorage.setItem(INGREDIENTS_LS_KEY, JSON.stringify(lsList));
      }

      // Also patch any custom LocalStorage arrays containing seed items missing images
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === KEY || k === SESSION_KEY || k === INGREDIENTS_LS_KEY) continue;
        const raw = localStorage.getItem(k);
        if (!raw || (raw[0] !== '[' && raw[0] !== '{')) continue;
        const parsed = JSON.parse(raw);
        let changed = false;
        const patchList = list => {
          if (!Array.isArray(list)) return;
          list.forEach(item => {
            if (item && typeof item === 'object' && (!item.image || !String(item.image).trim())) {
              const img = defaultFoodImage(item);
              if (img) { item.image = img; changed = true; updatedCount++; }
            }
          });
        };
        if (Array.isArray(parsed)) patchList(parsed);
        else if (parsed && Array.isArray(parsed.products)) patchList(parsed.products);
        if (changed) localStorage.setItem(k, JSON.stringify(parsed));
      }
    } catch (e) {
      console.warn('LocalStorage migration skipped:', e);
    }

    // 2. Migrate & sync IndexedDB products and movements stores safely
    if (typeof DB !== 'undefined' && DB && typeof DB.run === 'function') {
      try {
        await DB.run(['products', 'movements', 'suppliers'], 'readwrite', async tx => {
          const ps = tx.objectStore('products');
          const ms = tx.objectStore('movements');
          const ss = tx.objectStore('suppliers');
          const all = await DB.req(ps.getAll());
          const byId = new Map(all.map(p => [p.id, p]));

          // Ensure finished menu items have their local food photos and NO expiry batches
          for (const p of all) {
            if (p.isIngredient || String(p.id).startsWith('ING-')) continue;
            let changed = false;
            if (p.isIngredient !== false) { p.isIngredient = false; changed = true; }
            if (!p.image || !String(p.image).trim()) {
              const img = defaultFoodImage(p);
              if (img) { p.image = img; changed = true; }
            }
            if (Array.isArray(p.batches) && p.batches.length > 0) {
              p.batches = [];
              changed = true;
            }
            if (changed) {
              await DB.req(ps.put(p));
              updatedCount++;
            }
          }

          // Ensure all 12 raw ingredients exist in IndexedDB with local ingredient photos & FEFO batches
          const allMovs = await DB.req(ms.getAll());
          let maxMov = 0;
          allMovs.forEach(m => {
            const match = /^MOV-(\d+)$/.exec(m.id || '');
            if (match) maxMov = Math.max(maxMov, parseInt(match[1], 10));
          });

          for (const seed of seedIngredients) {
            const existing = byId.get(seed.id);
            if (!existing) {
              await DB.req(ps.put(seed));
              updatedCount++;
              // Record initial stock movement for newly seeded raw ingredient
              if (seed.stock > 0) {
                const movId = 'MOV-' + String(++maxMov).padStart(6, '0');
                const firstBatch = seed.batches && seed.batches[0];
                await DB.req(ms.put({
                  id: movId,
                  productId: seed.id,
                  productName: seed.name,
                  type: 'Initial Stock',
                  quantity: seed.stock,
                  previousStock: 0,
                  newStock: seed.stock,
                  date: seed.createdAt,
                  reason: 'Opening raw ingredient inventory',
                  refId: '',
                  batchId: firstBatch ? firstBatch.id : `${seed.id}-B01`,
                  dateReceived: firstBatch ? firstBatch.dateReceived : '',
                  expirationDate: firstBatch ? firstBatch.expirationDate : '',
                  userName: 'Administrator'
                }));
              }
            } else {
              let changed = false;
              if (!existing.isIngredient) { existing.isIngredient = true; changed = true; }
              if (!existing.categoryName && seed.categoryName) { existing.categoryName = seed.categoryName; changed = true; }
              if (!existing.image || !String(existing.image).trim() || existing.image.includes('/foods/')) {
                existing.image = seed.image;
                changed = true;
              }
              if (changed) {
                await DB.req(ps.put(existing));
                updatedCount++;
              }
            }
          }

          // Link suppliers to raw ingredients as well so Supplier dropdowns in Inventory Stock-In work seamlessly
          const sups = await DB.req(ss.getAll());
          const supMap = {
            'SUP-001': ['ING-001', 'ING-004', 'ING-008'],
            'SUP-002': ['ING-002', 'ING-003'],
            'SUP-003': ['ING-010', 'ING-011'],
            'SUP-004': ['ING-004', 'ING-005'],
            'SUP-005': ['ING-009'],
            'SUP-006': ['ING-006', 'ING-007'],
            'SUP-007': ['ING-002', 'ING-012']
          };
          for (const s of sups) {
            const extra = supMap[s.id];
            if (extra) {
              const set = new Set([...(s.productIds || []), ...extra]);
              if (set.size !== (s.productIds || []).length) {
                s.productIds = [...set];
                await DB.req(ss.put(s));
              }
            }
          }
        });
      } catch (e) {
        console.warn('IndexedDB ingredient migration skipped:', e);
      }
    }

    return updatedCount;
  }

  return {
    defaults,
    FALLBACK_IMAGE,
    FALLBACK_INGREDIENT_IMAGE,
    SEED_FOOD_IMAGES,
    SEED_INGREDIENT_IMAGES,
    INGREDIENT_CATEGORIES,
    buildSeedIngredients,
    defaultFoodImage,
    syncProductImages,
    all: () => Object.assign({}, load()),
    get: key => load()[key],
    set(key, value) { load()[key] = value; save(); },
    setMany(obj) { Object.assign(load(), obj); save(); },
    reset() { cache = Object.assign({}, defaults); save(); },

    /* Demo session (stores the logged-in user ID only - never passwords) */
    getSession() { try { return localStorage.getItem(SESSION_KEY); } catch (_) { return null; } },
    setSession(userId) { try { localStorage.setItem(SESSION_KEY, userId); } catch (_) { /* ignore */ } },
    clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ } }
  };
})();
