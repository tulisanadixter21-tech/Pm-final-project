/* =========================================================
   data.js - Default settings, first-launch sample data, and
   non-destructive batch migration for existing products.
   Sample data is generated ONCE (only when the database is empty)
   and is logically consistent: every stock level is the result of
   recorded inventory movements and sales transactions.
   ========================================================= */
'use strict';

const SampleData = {
  VERSION: 2,

  defaultSettings() {
    return {
      businessName: 'Sarap Corner Food Hub',
      address: '45 Katipunan Avenue, Quezon City, Metro Manila',
      phone: '0917 555 0123',
      email: 'hello@sarapcorner.example',
      currency: 'PHP',
      currencySymbol: '₱',
      lowStockThreshold: 10,
      expiryNearDays: 7,
      expiryVerySoonDays: 3,
      expiryCriticalDays: 1,
      receiptHeader: 'Thank you for dining with us!',
      receiptFooter: 'This is not an official receipt. Please come again!',
      receiptShowCashier: true,
      receiptShowCustomer: true
    };
  },

  /**
   * Seeds sample data only if the database has never been initialized and is empty.
   * If existing records are already present, preserves them and upgrades any product
   * without batch records so FEFO & shelf-life tracking work seamlessly.
   */
  async seedIfNeeded() {
    const meta = await DB.getSetting('meta');
    if (meta && meta.initialized) {
      await this.upgradeBatchesIfNeeded();
      if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
        await Prefs.syncProductImages();
      }
      return false;
    }
    const existing = await DB.count('products') + await DB.count('users');
    if (existing > 0) {
      await this.upgradeBatchesIfNeeded();
      if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
        await Prefs.syncProductImages();
      }
      await DB.setSetting('meta', { initialized: true, initializedAt: new Date().toISOString(), version: this.VERSION });
      return false;
    }
    await DB.bulkAdd(this.build());
    if (typeof Prefs !== 'undefined' && typeof Prefs.syncProductImages === 'function') {
      await Prefs.syncProductImages();
    }
    return true;
  },

  /**
   * Non-destructively ensures every existing product in IndexedDB has `batches`
   * synchronized with its `stock` and injects local food image paths when missing,
   * without overwriting current stock counts or history.
   */
  async upgradeBatchesIfNeeded() {
    const now = new Date();
    await DB.run(['products'], 'readwrite', async tx => {
      const ps = tx.objectStore('products');
      const all = await DB.req(ps.getAll());
      for (const p of all) {
        let changed = false;
        const isIng = !!(p.isIngredient || String(p.id || '').startsWith('ING-'));
        if (isIng) {
          if (!p.isIngredient) { p.isIngredient = true; changed = true; }
          const hadBatches = Array.isArray(p.batches) && p.batches.length > 0;
          const sum = hadBatches ? p.batches.reduce((s, b) => s + (Number(b.qty) || 0), 0) : 0;
          if (!hadBatches || sum !== p.stock) {
            Utils.ensureProductBatches(p, now);
            changed = true;
          }
        } else {
          if (p.isIngredient !== false) { p.isIngredient = false; changed = true; }
          if (Array.isArray(p.batches) && p.batches.length > 0) {
            p.batches = [];
            changed = true;
          }
        }
        if (!p.image || !String(p.image).trim()) {
          const defaultImg = typeof Prefs !== 'undefined' && typeof Prefs.defaultFoodImage === 'function'
            ? Prefs.defaultFoodImage(p)
            : '';
          if (defaultImg) {
            p.image = defaultImg;
            changed = true;
          }
        }
        if (changed) {
          await DB.req(ps.put(p));
        }
      }
    });
  },

  /** Creates realistic FEFO batches for a product totaling `p.stock` relative to `now`. */
  defaultBatchesForProduct(p, now = new Date()) {
    const U = Utils;
    const stock = Math.max(0, Number(p.stock) || 0);
    if (stock <= 0) return [];

    // Custom realistic batch splits for perishable food items
    const presets = {
      P001: [{ daysRec: -5, daysExp: 2, ratio: 0.35, note: 'Fresh beef patties & buns batch A' }, { daysRec: -1, daysExp: 6, ratio: 0.65, note: 'Fresh beef patties & buns batch B' }],
      P002: [{ daysRec: -7, daysExp: 14, ratio: 0.5, note: 'Frozen potato fries lot 1' }, { daysRec: -2, daysExp: 25, ratio: 0.5, note: 'Frozen potato fries lot 2' }],
      P003: [{ daysRec: -4, daysExp: 5, ratio: 0.4, note: 'Brewed tea concentrate batch 1' }, { daysRec: -1, daysExp: 12, ratio: 0.6, note: 'Brewed tea concentrate batch 2' }],
      P004: [{ daysRec: -6, daysExp: -1, ratio: 0.15, note: 'Prepared mozzarella crust tray (expired)' }, { daysRec: -2, daysExp: 4, ratio: 0.85, note: 'Fresh mozzarella & dough tray' }],
      P005: [{ daysRec: -4, daysExp: 1, ratio: 1.0, note: 'Chilled chocolate fudge cake slices' }],
      P006: [{ daysRec: -5, daysExp: 3, ratio: 0.4, note: 'Chicken fillet & coleslaw prep A' }, { daysRec: -1, daysExp: 8, ratio: 0.6, note: 'Chicken fillet & coleslaw prep B' }],
      P007: [{ daysRec: -4, daysExp: 5, ratio: 0.45, note: 'Sweet tomato meat sauce batch A' }, { daysRec: -1, daysExp: 10, ratio: 0.55, note: 'Sweet tomato meat sauce batch B' }],
      P008: [{ daysRec: -4, daysExp: 6, ratio: 0.4, note: 'Marinated chicken cutlets batch A' }, { daysRec: -1, daysExp: 11, ratio: 0.6, note: 'Marinated chicken cutlets batch B' }],
      P009: [{ daysRec: -5, daysExp: 4, ratio: 0.35, note: 'Fresh milk & pearls batch A' }, { daysRec: -1, daysExp: 9, ratio: 0.65, note: 'Fresh milk & pearls batch B' }],
      P010: [{ daysRec: -3, daysExp: 2, ratio: 1.0, note: 'Pancake batter mix' }]
    };

    const spec = presets[p.id] || [{ daysRec: -3, daysExp: 10, ratio: 1.0, note: 'Initial stock batch' }];
    let remaining = stock;
    const batches = [];
    spec.forEach((s, i) => {
      const qty = i === spec.length - 1 ? remaining : Math.max(1, Math.min(remaining - (spec.length - 1 - i), Math.round(stock * s.ratio)));
      if (qty <= 0) return;
      remaining -= qty;
      batches.push({
        id: `${p.id}-B${U.pad(i + 1, 2)}`,
        dateReceived: U.dateKey(U.addDays(now, s.daysRec)),
        expirationDate: U.dateKey(U.addDays(now, s.daysExp)),
        qty,
        initialQty: qty,
        note: s.note
      });
    });
    return U.sortBatchesFEFO(batches);
  },

  /** Builds a complete, consistent sample dataset relative to `now`. */
  build(now = new Date()) {
    const U = Utils;
    let seed = 20261105;
    const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const at = (dayOffset, h, m) => { const d = U.addDays(U.startOfDay(now), dayOffset); d.setHours(h, m, randInt(0, 59), 0); return d; };

    const categories = [
      { id: 'CAT-01', name: 'Burgers & Sandwiches', description: 'Burgers, sandwiches and wraps' },
      { id: 'CAT-02', name: 'Sides & Snacks', description: 'Fries and light snacks' },
      { id: 'CAT-03', name: 'Beverages', description: 'Cold and hot drinks' },
      { id: 'CAT-04', name: 'Pizza & Pasta', description: 'Pizza slices and pasta dishes' },
      { id: 'CAT-05', name: 'Desserts', description: 'Cakes and sweets' },
      { id: 'CAT-06', name: 'Chicken & Rice Meals', description: 'Fried chicken and rice meals' },
      { id: 'CAT-07', name: 'Breakfast', description: 'All-day breakfast items' }
    ];
    const catName = id => (categories.find(c => c.id === id) || {}).name || '';

    const created = at(-31, 7, 0).toISOString();
    const P = (id, name, categoryId, price, cost, unit, reorderLevel, opening, weight, defaultShelfLifeDays, description, image) =>
      ({
        id, name, categoryId, description, price, cost, stock: 0, reorderLevel, unit,
        defaultShelfLifeDays, batches: [],
        image: image || (typeof Prefs !== 'undefined' && Prefs.defaultFoodImage ? Prefs.defaultFoodImage(id, name) : ''),
        status: 'active',
        createdAt: created, updatedAt: created, _opening: opening, _weight: weight
      });
    const products = [
      P('P001', 'Classic Burger', 'CAT-01', 120, 62, 'pc', 15, 150, 10, 7, 'Quarter-pound beef patty with lettuce, tomato, cheese and house sauce.', 'assets/images/foods/classic-burger.jpg'),
      P('P002', 'Fries Large', 'CAT-02', 55.5, 22, 'serving', 20, 180, 9, 21, 'Crispy golden potato fries, large serving.', 'assets/images/foods/fries-large.jpg'),
      P('P003', 'Iced Tea', 'CAT-03', 25, 8, 'cup', 30, 260, 9, 10, 'House-brewed lemon iced tea, 16 oz.', 'assets/images/foods/iced-tea.jpg'),
      P('P004', 'Cheese Pizza Slice', 'CAT-04', 85, 38, 'slice', 15, 110, 6, 5, 'Thin-crust slice with mozzarella and tomato sauce.', 'assets/images/foods/cheese-pizza-slice.jpg'),
      P('P005', 'Chocolate Cake', 'CAT-05', 150, 68, 'slice', 10, 45, 3, 5, 'Moist chocolate cake slice with fudge frosting.', 'assets/images/foods/chocolate-cake.jpg'),
      P('P006', 'Chicken Sandwich', 'CAT-01', 95, 48, 'pc', 15, 110, 6, 7, 'Breaded chicken fillet sandwich with coleslaw.', 'assets/images/foods/chicken-sandwich.jpg'),
      P('P007', 'Spaghetti', 'CAT-04', 100, 42, 'plate', 15, 110, 6, 7, 'Filipino-style sweet spaghetti with hotdog and cheese.', 'assets/images/foods/spaghetti.jpg'),
      P('P008', 'Fried Chicken', 'CAT-06', 110, 52, 'pc', 20, 150, 8, 10, 'Crispy fried chicken (1 pc) with rice and gravy.', 'assets/images/foods/fried-chicken.jpg'),
      P('P009', 'Milk Tea', 'CAT-03', 75, 28, 'cup', 25, 180, 7, 7, 'Classic milk tea with tapioca pearls, 16 oz.', 'assets/images/foods/milk-tea.jpg'),
      P('P010', 'Pancakes', 'CAT-07', 90, 32, 'plate', 10, 30, 3, 4, 'Stack of three fluffy pancakes with butter and syrup.', 'assets/images/foods/pancakes.jpg')
    ];

    const customers = [
      ['Maria Santos', '0917 234 5678', 'maria.santos@example.com', 'Brgy. Loyola Heights, Quezon City'],
      ['Juan Dela Cruz', '0918 345 6789', 'juan.delacruz@example.com', 'Marikina Heights, Marikina City'],
      ['Angela Reyes', '0919 456 7890', 'angela.reyes@example.com', 'Cubao, Quezon City'],
      ['Mark Villanueva', '0920 567 8901', 'mark.v@example.com', 'San Juan City, Metro Manila'],
      ['Kristine Bautista', '0921 678 9012', 'kbautista@example.com', 'Project 4, Quezon City'],
      ['Paolo Garcia', '0922 789 0123', '', 'Pasig City, Metro Manila'],
      ['Liza Mendoza', '0923 890 1234', 'liza.mendoza@example.com', 'Teachers Village, Quezon City']
    ].map((c, i) => ({
      id: 'CUS-' + U.pad(i + 1, 4), name: c[0], phone: c[1], email: c[2], address: c[3],
      dateRegistered: at(-90 + i * 7, 10, 0).toISOString()
    }));

    const suppliers = [
      ['Golden Grain Bakery Supply', 'Ramon Cruz', '0917 111 2233', 'orders@goldengrain.example', 'Malabon City, Metro Manila', ['P001', 'P006', 'P010'], 'active'],
      ['FreshFarm Poultry Trading', 'Elena Torres', '0918 222 3344', 'sales@freshfarm.example', 'San Jose del Monte, Bulacan', ['P006', 'P008'], 'active'],
      ['Metro Beverage Distributors', 'Victor Lim', '0919 333 4455', 'metrobev@example.com', 'Caloocan City, Metro Manila', ['P003', 'P009'], 'active'],
      ['Bella Italia Food Supply', 'Grace Uy', '0920 444 5566', 'grace@bellaitalia.example', 'Makati City, Metro Manila', ['P004', 'P007'], 'active'],
      ['Sweet Treats Pastry House', 'Nina Castillo', '0921 555 6677', 'hello@sweettreats.example', 'Quezon City, Metro Manila', ['P005'], 'active'],
      ['Prime Potato Co.', 'Albert Ong', '0922 666 7788', 'albert@primepotato.example', 'Antipolo City, Rizal', ['P002'], 'active'],
      ['Island Meat Supply', 'Dennis Ramos', '0923 777 8899', '', 'Valenzuela City, Metro Manila', ['P001'], 'inactive']
    ].map((s, i) => ({
      id: 'SUP-' + U.pad(i + 1, 3), name: s[0], contactPerson: s[1], phone: s[2], email: s[3], address: s[4],
      productIds: s[5], status: s[6], createdAt: at(-120, 9, 0).toISOString()
    }));
    const supplierOf = pid => suppliers.find(s => s.status === 'active' && s.productIds.includes(pid));

    const ALL = ['dashboard', 'products', 'inventory', 'sales', 'customers', 'suppliers', 'reports', 'users', 'settings'];
    const users = [
      { id: 'U001', fullName: 'Administrator', username: 'admin', password: 'admin123', role: 'admin', phone: '0917 555 0100', status: 'active', permissions: ALL },
      { id: 'U002', fullName: 'Carla Mae Ramos', username: 'cashier', password: 'staff123', role: 'staff', phone: '0917 555 0101', status: 'active', permissions: ['dashboard', 'sales', 'customers'] },
      { id: 'U003', fullName: 'Jerome Navarro', username: 'inventory', password: 'staff123', role: 'staff', permissions: ['dashboard', 'products', 'inventory', 'suppliers', 'reports'], phone: '0917 555 0102' },
      { id: 'U004', fullName: 'Bea Lim', username: 'bea', password: 'staff123', role: 'staff', phone: '0917 555 0103', status: 'inactive', permissions: ['dashboard', 'sales'] }
    ].map(u => ({ ...u, createdAt: at(-120, 8, 0).toISOString() }));

    /* ---------- Simulate inventory + sales history ---------- */
    const movements = [];
    const transactions = [];
    let movNo = 0;
    const move = (p, type, qty, newStock, date, reason, refId = '', userName = 'Administrator', extra = {}) => {
      movements.push({
        id: 'MOV-' + U.pad(++movNo, 6), productId: p.id, productName: p.name, type, quantity: qty,
        previousStock: p.stock, newStock, date: date.toISOString(), reason, refId, userName,
        ...extra
      });
      p.stock = newStock;
      p.updatedAt = date.toISOString();
    };

    products.forEach(p => {
      const recDate = U.dateKey(at(-30, 7, 0));
      const expDate = U.dateKey(U.addDays(at(-30, 7, 0), p.defaultShelfLifeDays || 14));
      move(p, 'Initial Stock', p._opening, p._opening, at(-30, 7, 0), 'Opening inventory count', '', 'Administrator', {
        batchId: `${p.id}-B01`, dateReceived: recDate, expirationDate: expDate
      });
    });

    const totalWeight = products.reduce((s, p) => s + p._weight, 0);
    const pick = () => { let r = rand() * totalWeight; for (const p of products) { r -= p._weight; if (r <= 0) return p; } return products[0]; };
    const cashiers = [users[1], users[1], users[1], users[0]];

    for (let day = -29; day <= 0; day++) {
      if (day === -15 || day === -7) {
        products.forEach(p => {
          if (p.id === 'P005' || p.id === 'P010') return;
          if (p.stock < p._opening * 0.5) {
            const sup = supplierOf(p.id);
            const qty = p._opening - p.stock;
            const d = at(day, 7, 30);
            move(p, 'Stock In', qty, p.stock + qty, d, 'Supplier delivery' + (sup ? ' - ' + sup.name : ''), '', 'Jerome Navarro', {
              batchId: `${p.id}-B${day === -15 ? '02' : '03'}`,
              dateReceived: U.dateKey(d),
              expirationDate: U.dateKey(U.addDays(d, p.defaultShelfLifeDays || 10))
            });
          }
        });
      }
      const date0 = U.addDays(U.startOfDay(now), day);
      const weekend = date0.getDay() === 0 || date0.getDay() === 6;
      const count = randInt(weekend ? 6 : 4, weekend ? 10 : 7);
      const times = Array.from({ length: count }, () => randInt(8 * 60, 21 * 60)).sort((a, b) => a - b);
      let seq = 0;
      times.forEach(mins => {
        const date = at(day, Math.floor(mins / 60), mins % 60);
        if (date > now) return;
        const lines = new Map();
        const n = randInt(1, 4);
        for (let k = 0; k < n; k++) {
          const p = pick();
          const qty = randInt(1, rand() < 0.75 ? 2 : 3);
          const already = lines.get(p.id) || 0;
          if (p.stock - already >= qty) lines.set(p.id, already + qty);
        }
        if (!lines.size) return;
        const cust = rand() < 0.35 ? customers[randInt(0, customers.length - 1)] : null;
        const cashier = cashiers[randInt(0, cashiers.length - 1)];
        const id = `TXN-${U.compactDate(date)}-${U.pad(++seq, 4)}`;
        const items = [...lines.entries()].map(([pid, qty]) => {
          const p = products.find(x => x.id === pid);
          return { productId: p.id, name: p.name, category: catName(p.categoryId), unit: p.unit, qty, price: p.price, cost: p.cost, subtotal: U.round2(p.price * qty) };
        });
        const subtotal = U.round2(items.reduce((s, i) => s + i.subtotal, 0));
        let discountType = 'none', discountValue = 0, discount = 0;
        const r = rand();
        if (cust && r < 0.15) { discountType = 'percent'; discountValue = 20; discount = U.round2(subtotal * 0.2); }
        else if (r > 0.95 && subtotal >= 200) { discountType = 'fixed'; discountValue = 20; discount = 20; }
        const total = U.round2(subtotal - discount);
        const options = [Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.max(1000, Math.ceil(total / 1000) * 1000), total];
        const cash = options[randInt(0, options.length - 1)];
        items.forEach(i => {
          const p = products.find(x => x.id === i.productId);
          move(p, 'Sale', i.qty, p.stock - i.qty, date, 'Sold - ' + id, id, cashier.fullName);
        });
        transactions.push({
          id, date: date.toISOString(), items, itemCount: items.reduce((s, i) => s + i.qty, 0),
          subtotal, discountType, discountValue, discount, total, cash, change: U.round2(cash - total),
          customerId: cust ? cust.id : null, customerName: cust ? cust.name : 'Guest',
          cashierId: cashier.id, cashierName: cashier.fullName, status: 'completed'
        });
      });
    }

    // Guarantee realistic alert states for demonstration (recorded as proper movements)
    const cake = products.find(p => p.id === 'P005');
    if (cake.stock > cake.reorderLevel) {
      move(cake, 'Stock Out', cake.stock - (cake.reorderLevel - 3), cake.reorderLevel - 3, new Date(now), 'Spoilage - expired slices disposed', '', 'Jerome Navarro');
    }
    const pancakes = products.find(p => p.id === 'P010');
    if (pancakes.stock > 0) {
      move(pancakes, 'Adjustment', pancakes.stock, 0, new Date(now), 'Physical count correction - batter spoiled', '', 'Jerome Navarro');
    }

    // Clean up temporary simulation fields on menu items (finished menu items do not track expiry batches)
    products.forEach(p => {
      delete p._opening;
      delete p._weight;
      p.isIngredient = false;
      p.batches = [];
    });

    // Seed raw kitchen ingredients (with local ingredient photos & FEFO expiry batches) for the Inventory module
    const rawIngredients = (typeof Prefs !== 'undefined' && typeof Prefs.buildSeedIngredients === 'function')
      ? Prefs.buildSeedIngredients(now)
      : [];
    rawIngredients.forEach(ing => {
      products.push(ing);
      if (ing.stock > 0) {
        const firstBatch = ing.batches && ing.batches[0];
        movements.push({
          id: 'MOV-' + U.pad(++movNo, 6),
          productId: ing.id,
          productName: ing.name,
          type: 'Initial Stock',
          quantity: ing.stock,
          previousStock: 0,
          newStock: ing.stock,
          date: ing.createdAt,
          reason: 'Opening raw ingredient inventory',
          refId: '',
          batchId: firstBatch ? firstBatch.id : `${ing.id}-B01`,
          dateReceived: firstBatch ? firstBatch.dateReceived : '',
          expirationDate: firstBatch ? firstBatch.expirationDate : '',
          userName: 'Administrator'
        });
      }
    });
    movements.sort((a, b) => a.date.localeCompare(b.date));

    return {
      categories, products, customers, suppliers, users, movements, transactions,
      settings: [
        { key: 'business', value: this.defaultSettings() },
        { key: 'meta', value: { initialized: true, initializedAt: now.toISOString(), version: this.VERSION } }
      ]
    };
  }
};
