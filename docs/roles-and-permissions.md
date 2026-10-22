# Boat OS — Roles and Permissions

This document describes the permissions currently enforced by the application. Reviewed on 22 October 2026.

## 1. Roles

| Role | Purpose | Access summary |
| --- | --- | --- |
| **Admin** (`admin`) | Application administration and operational oversight | Can manage business records, users, Settings, backups, imports and resets. |
| **Planner** (`planner`) | Production and shipment planning | Can create and edit products, lots and shipments; manage RM batches and GRN receipts; and export JSON backups. Cannot manage users or Settings, import/reset data, or delete products, lots or shipments. |
| **POC** (`poc`) | Point of contact responsible for production progress | Can view all operational records. Can update progress, batches, receipts and notes only on lots assigned to their linked point of contact. Cannot change the production plan or delete records. |
| **Viewer** (`viewer`) | Monitoring and reporting | Can browse operational screens, read history and download CSV reports. Cannot change business records or administration settings. |

Roles are predefined. The application does not currently provide custom roles or a permission editor.

## 2. Permission matrix

**Yes** means the role is permitted to perform the action, subject to validation and record-specific rules. **Assigned lots** means the lot's POC must match the user's linked POC. **No** means the API refuses the action.

| Action | Admin | Planner | POC | Viewer |
| --- | --- | --- | --- | --- |
| View products, active lots and completed lots | Yes | Yes | Yes | Yes |
| View lot details, batches, receipts and history | Yes | Yes | Yes | Yes |
| View finished-goods shipments and their history | Yes | Yes | Yes | Yes |
| View month-end summaries | Yes | Yes | Yes | Yes |
| Search, filter and sort operational records | Yes | Yes | Yes | Yes |
| Download lot, shipment and month-end CSV reports | Yes | Yes | Yes | Yes |
| View dropdown values and read-only operational Settings | Yes | Yes | Yes | Yes |
| Create or edit products | Yes | Yes | No | No |
| Delete products | Yes | No | No | No |
| Create lots | Yes | Yes | No | No |
| Edit lot planning fields | Yes | Yes | No | No |
| Edit lot progress fields | Yes | Yes | Assigned lots | No |
| Delete lots | Yes | No | No | No |
| Add or edit RM batches | Yes | Yes | Assigned lots | No |
| Delete RM batches | Yes | Yes | No | No |
| Add or edit GRN receipts | Yes | Yes | Assigned lots | No |
| Delete GRN receipts | Yes | Yes | No | No |
| Post lot update notes | Yes | Yes | Assigned lots | No |
| Create or edit shipments and product lines | Yes | Yes | No | No |
| Revise shipment ETAs or record warehouse arrival | Yes | Yes | No | No |
| Post shipment update notes | Yes | Yes | No | No |
| Delete shipments | Yes | No | No | No |
| Add, rename or delete dropdown values | Yes | No | No | No |
| Change idle sign-out time or company time zone | Yes | No | No | No |
| View the Users table | Yes | No | No | No |
| Invite users or resend invitations | Yes | No | No | No |
| Edit user names, roles and POC links | Yes | No | No | No |
| Enable, disable or delete user accounts | Yes | No | No | No |
| Export a JSON backup | Yes | Yes | No | No |
| Import a JSON backup using merge or replace | Yes | No | No | No |
| Reset all application business data | Yes | No | No | No |
| Change their own password and sign out | Yes | Yes | Yes | Yes |

**Planner deletion exception:** Planners can delete RM batches and GRN receipts. The executable `deleteEntries` grant allows this, even though the short Planner description in the application currently says “No … record deletes.” Products, lots and shipments remain Admin-only deletes.

## 3. POC assignment and field restrictions

A POC user must be linked to a point-of-contact value in their user account. The API compares that linked POC ID with the lot's POC ID. An unassigned lot or a lot assigned to a different POC is read-only for that user. Multiple users linked to the same POC have progress access to the same assigned lots.

Assignment limits editing, not visibility: POC users can still read other lots, shipments, reports and history, and export CSV reports.

### Planning fields — Admin and Planner only

| Lot field | Internal field |
| --- | --- |
| Product | `productId` |
| Lot label/reference | `label` |
| Product category | `category` |
| Direct FG flag | `directFg` |
| Manufacturing partner / EMS | `ems` |
| Point of contact | `poc` |
| RM readiness mode | `rmMode` |
| Required RM components | `rmComponents` |
| Lot quantity | `lotQty` |
| Original planned completion / warehouse receipt date | `plannedDate` |

### Progress fields — also editable by the assigned POC

| Lot field | Internal field |
| --- | --- |
| Overall status | `status` |
| Current production stage | `stage` |
| Ready quantity | `readyQty` |
| Fresh production quantity | `freshProductionQty` |
| Rework quantity and reason | `reworkQty`, `reworkReason` |
| RM ready date | `rmReadyDate` |
| Revised completion / receipt ETA | `revisedEta` |
| Actual completion / receipt date | `actualDate` |
| Logistics mode | `logisticsMode` |
| Blocker category and description | `blockerCategory`, `blockerDescription` |
| Follow-up date and note | `followUpDate`, `followUpNote` |

Assigned POCs can also add and edit batches and receipts under the lot, including their labels, quantities, dates and notes, and post lot update notes. They cannot delete those entries, add new required components to the lot or change its readiness mode.

## 4. User administration and account access

- Only Admins can access the Users table and administer another user's account.
- Invited users choose a password through their invitation link before their account becomes active.
- A POC account requires a valid linked point of contact.
- User email addresses cannot be changed through the user-edit API.
- Changing a user's role or account status revokes their existing sessions. Deleting a user also revokes sessions and invalidates unused account tokens.
- The last active Admin cannot be demoted, disabled or deleted. Another active Admin must exist first.
- Every role can change its own password. A successful password change preserves the new current session and ends the user's other sessions.
- Invitation acceptance and forgotten-password/reset flows use token-based public routes. They do not grant operational access without a valid active account/session.

## 5. Rules that apply even when a role has permission

- Permissions do not bypass validation. Quantities, dates, required references and record relationships must still be valid.
- Receipt quantities cannot exceed the lot's remaining quantity. Changes to receipts can change the lot's completion status.
- A batch can only be added to a lot tracked by component and to a component selected on that lot.
- Existing system dropdown values are protected, and values in use cannot be freely renamed or deleted.
- Product deletion can be refused when the product is used in shipment lines.
- Deletes of business records are soft deletes. Audit history is protected from editing, including by Admins through the application.
- Import replacement and data reset require their existing confirmation steps; Admin access does not skip them.
- Blank labels on new lots, batches and receipts are generated on the backend. Automatic numbering does not grant permission to create the record.

## 6. How permissions are enforced

The browser uses the signed-in user's allowed actions to show, hide or disable controls. The API independently checks the session, role permission and, where applicable, the lot's POC assignment. Hiding a button is not the security boundary.

Signed-in writes require a valid CSRF token. Missing or expired sessions return an authentication error; forbidden actions return a permission error. Lot edits additionally use record versions and row locks to protect concurrent changes.

| API access rule | Meaning |
| --- | --- |
| `publicRoute()` | Public health or authentication/token flow; no signed-in operational access is implied. |
| `requireSignedIn()` | Any authenticated user may use the route. |
| `requirePermission(action)` | The user's role must include the named permission. |
| `requireLotAccess()` | Requires authentication and CSRF checks; the service then checks full, progress-only or read-only access for the specific lot. |

### Named action grants

| Permission key | Admin | Planner | POC | Viewer |
| --- | --- | --- | --- | --- |
| `manageSettings` | Yes | No | No | No |
| `manageData` | Yes | No | No | No |
| `exportBackup` | Yes | Yes | No | No |
| `editProducts` | Yes | Yes | No | No |
| `deleteProducts` | Yes | No | No | No |
| `createLots` | Yes | Yes | No | No |
| `deleteLots` | Yes | No | No | No |
| `editShipments` | Yes | Yes | No | No |
| `deleteShipments` | Yes | No | No | No |
| `deleteEntries` | Yes | Yes | No | No |

POC progress access and shared read/CSV access are checked separately from these named action grants. POC and Viewer having no named grants does not prevent their permitted read access.

## 7. Source of truth

Update this document when the executable permission rules change.

- [Role definitions, action grants and planning fields](../packages/domain/src/permissions.ts)
- [API authentication, CSRF and permission guards](../apps/api/src/core/access.ts)
- [API route-to-permission table](../apps/api/src/api.test.ts)
- [Server-side lot access mapping](../apps/api/src/modules/lots/lot-view.ts)
- [Lot locking and assignment checks](../apps/api/src/modules/lots/lot-lock.ts)
- [User administration and last-Admin protection](../apps/api/src/modules/users/users.service.ts)
- [Browser access helpers](../apps/web/src/access.ts)
