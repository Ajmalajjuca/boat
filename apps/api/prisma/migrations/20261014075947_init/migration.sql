CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'planner', 'poc', 'viewer');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('invite', 'password_reset');

-- CreateEnum
CREATE TYPE "RmMode" AS ENUM ('all', 'components');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('lot', 'shipment');

-- CreateEnum
CREATE TYPE "EtaKind" AS ENUM ('planned', 'current');

-- CreateEnum
CREATE TYPE "LookupKind" AS ENUM ('segment', 'category', 'ems', 'poc', 'status', 'stage', 'blocker', 'logistics', 'component', 'shipmentStage');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "role" "Role" NOT NULL,
    "poc_id" UUID,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'invited',
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lookup_values" (
    "id" UUID NOT NULL,
    "kind" "LookupKind" NOT NULL,
    "value" CITEXT NOT NULL,
    "system_key" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "variant" CITEXT NOT NULL DEFAULT '',
    "segment_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "label" CITEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "direct_fg" BOOLEAN NOT NULL DEFAULT false,
    "ems_id" UUID,
    "poc_id" UUID,
    "status_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "rm_mode" "RmMode" NOT NULL DEFAULT 'all',
    "ready_qty" INTEGER NOT NULL DEFAULT 0,
    "lot_qty" INTEGER NOT NULL DEFAULT 0,
    "fresh_production_qty" INTEGER NOT NULL DEFAULT 0,
    "rework_qty" INTEGER NOT NULL DEFAULT 0,
    "rework_reason" TEXT NOT NULL DEFAULT '',
    "rm_ready_date" DATE,
    "planned_date" DATE,
    "revised_eta" DATE,
    "actual_date" DATE,
    "logistics_id" UUID,
    "blocker_id" UUID,
    "blocker_description" TEXT NOT NULL DEFAULT '',
    "follow_up_date" DATE,
    "follow_up_note" TEXT NOT NULL DEFAULT '',
    "grn_total" INTEGER NOT NULL DEFAULT 0,
    "completed_on" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_components" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "lot_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rm_batches" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "planned_qty" INTEGER NOT NULL DEFAULT 0,
    "planned_date" DATE,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "received_date" DATE,
    "status" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "rm_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grn_receipts" (
    "id" UUID NOT NULL,
    "lot_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "grn_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "number" CITEXT NOT NULL,
    "vessel" TEXT NOT NULL,
    "etd" DATE,
    "planned_eta" DATE,
    "revised_eta" DATE,
    "actual_arrival" DATE,
    "stage_id" UUID,
    "remarks" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" UUID,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eta_revisions" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "kind" "EtaKind" NOT NULL,
    "previous_date" DATE,
    "new_date" DATE,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eta_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "changes" JSONB,
    "actor_id" UUID,
    "actor_name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_active_key" ON "users"("email") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "lookup_values_kind_idx" ON "lookup_values"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_kind_value_active_key" ON "lookup_values"("kind", "value") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "lookup_values_kind_system_key_active_key" ON "lookup_values"("kind", "system_key") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "products_segment_id_idx" ON "products"("segment_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_name_variant_active_key" ON "products"("name", "variant") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "lots_product_id_idx" ON "lots"("product_id");

-- CreateIndex
CREATE INDEX "lots_status_id_idx" ON "lots"("status_id");

-- CreateIndex
CREATE INDEX "lots_poc_id_idx" ON "lots"("poc_id");

-- CreateIndex
CREATE INDEX "lots_planned_date_idx" ON "lots"("planned_date");

-- CreateIndex
CREATE INDEX "lots_completed_on_idx" ON "lots"("completed_on");

-- CreateIndex
CREATE UNIQUE INDEX "lots_product_label_active_key" ON "lots"("product_id", "label") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "lot_components_lot_id_idx" ON "lot_components"("lot_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_components_lot_component_active_key" ON "lot_components"("lot_id", "component_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "rm_batches_lot_id_component_id_idx" ON "rm_batches"("lot_id", "component_id");

-- CreateIndex
CREATE INDEX "grn_receipts_lot_id_date_idx" ON "grn_receipts"("lot_id", "date");

-- CreateIndex
CREATE INDEX "grn_receipts_date_idx" ON "grn_receipts"("date");

-- CreateIndex
CREATE INDEX "shipments_actual_arrival_idx" ON "shipments"("actual_arrival");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_number_active_key" ON "shipments"("number") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "shipment_items_shipment_id_idx" ON "shipment_items"("shipment_id");

-- CreateIndex
CREATE INDEX "shipment_items_product_id_idx" ON "shipment_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_shipment_product_active_key" ON "shipment_items"("shipment_id", "product_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "eta_revisions_shipment_id_created_at_idx" ON "eta_revisions"("shipment_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_created_at_idx" ON "activity_logs"("entity_type", "entity_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_ems_id_fkey" FOREIGN KEY ("ems_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_poc_id_fkey" FOREIGN KEY ("poc_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_logistics_id_fkey" FOREIGN KEY ("logistics_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_components" ADD CONSTRAINT "lot_components_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_components" ADD CONSTRAINT "lot_components_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_batches" ADD CONSTRAINT "rm_batches_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rm_batches" ADD CONSTRAINT "rm_batches_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "lookup_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_receipts" ADD CONSTRAINT "grn_receipts_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "lookup_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eta_revisions" ADD CONSTRAINT "eta_revisions_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
