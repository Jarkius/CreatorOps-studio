-- products.primary_asset_id must point at an asset of the SAME workspace (D-037).
-- Written by hand: Drizzle cannot express this circular composite reference in its schema types.
-- A product with no primary image (NULL) is not checked (MATCH SIMPLE). Deleting an asset that
-- is still a product's primary image is refused; the service clears the product first.
ALTER TABLE "products"
  ADD CONSTRAINT "products_primary_asset_fk"
  FOREIGN KEY ("workspace_id", "primary_asset_id")
  REFERENCES "public"."assets" ("workspace_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
