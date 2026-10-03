-- ============================================================
-- CHA-CHING TRACKER — Multi-user RLS Setup
-- Run this in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. ADD user_id COLUMNS where needed
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE income_streams ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. ENABLE RLS on user-owned tables
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_streams ENABLE ROW LEVEL SECURITY;

-- payment_modes and platforms are shared lookup tables — public read, no writes from app
ALTER TABLE payment_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE platforms ENABLE ROW LEVEL SECURITY;

-- 3. DROP old policies if re-running
DROP POLICY IF EXISTS "Users see own transactions" ON transactions;
DROP POLICY IF EXISTS "Users insert own transactions" ON transactions;
DROP POLICY IF EXISTS "Users update own transactions" ON transactions;
DROP POLICY IF EXISTS "Users delete own transactions" ON transactions;

DROP POLICY IF EXISTS "Users see own categories" ON categories;
DROP POLICY IF EXISTS "Users insert own categories" ON categories;
DROP POLICY IF EXISTS "Users update own categories" ON categories;
DROP POLICY IF EXISTS "Users delete own categories" ON categories;

DROP POLICY IF EXISTS "Users see own income" ON income_streams;
DROP POLICY IF EXISTS "Users insert own income" ON income_streams;
DROP POLICY IF EXISTS "Users update own income" ON income_streams;
DROP POLICY IF EXISTS "Users delete own income" ON income_streams;

DROP POLICY IF EXISTS "Public read payment_modes" ON payment_modes;
DROP POLICY IF EXISTS "Public read platforms" ON platforms;

-- 4. TRANSACTIONS — per user
CREATE POLICY "Users see own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own transactions" ON transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own transactions" ON transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own transactions" ON transactions FOR DELETE USING (auth.uid() = user_id);

-- 5. CATEGORIES — per user
CREATE POLICY "Users see own categories" ON categories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own categories" ON categories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own categories" ON categories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own categories" ON categories FOR DELETE USING (auth.uid() = user_id);

-- 6. INCOME STREAMS — per user
CREATE POLICY "Users see own income" ON income_streams FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own income" ON income_streams FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own income" ON income_streams FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own income" ON income_streams FOR DELETE USING (auth.uid() = user_id);

-- 7. PAYMENT_MODES & PLATFORMS — shared lookup, anyone signed in can read
CREATE POLICY "Public read payment_modes" ON payment_modes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Public read platforms" ON platforms FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- 8. CLAIM YOUR EXISTING DATA
-- After running the above, go to:
--   Supabase Dashboard → Authentication → Users
--   Copy your UUID (the long string next to shimrithpriscilla@gmail.com)
-- Then run these UPDATE statements with your UUID:
-- ============================================================
-- UPDATE transactions SET user_id = 'PASTE_YOUR_UUID_HERE' WHERE user_id IS NULL;
-- UPDATE categories SET user_id = 'PASTE_YOUR_UUID_HERE' WHERE user_id IS NULL;
-- UPDATE income_streams SET user_id = 'PASTE_YOUR_UUID_HERE' WHERE user_id IS NULL;

