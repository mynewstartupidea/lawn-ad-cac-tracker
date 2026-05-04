-- Add postal_code column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS postal_code text;
