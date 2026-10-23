# Tallin Sales — Full UI Redesign Prompt

**Use this prompt to apply a classy, best-in-class design upgrade and make every page full responsive.** Treat it as the single source of truth when regenerating or redesigning any page.

---

## 1. Design principles (classy upgrade)

- **Refined, not loud:** Premium feel through restraint: subtle gradients, soft shadows, generous whitespace, clear hierarchy. No clutter or decorative noise.
- **Consistent system:** Every page uses the same tokens (colors, radii, shadows, spacing, typography). One design language everywhere.
- **Smooth and responsive:** All interactions use 200–350ms transitions; layout adapts to mobile, tablet, and desktop without horizontal scroll; touch targets ≥ 44px on mobile.
- **Accessible:** Sufficient contrast, focus rings on interactive elements, semantic headings, and ARIA where needed (e.g. modals, loading states).

---

## 2. Global design system (apply to all pages)

### Colors
- **Background:** Light gradient `linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)` or equivalent (slate-50 → slate-100).
- **Primary:** Indigo — `indigo-600` (buttons, links, active states), `indigo-50` (highlights), `indigo-100` (icon backgrounds).
- **Surfaces:** White cards; borders `gray-100` or `gray-200`.
- **Text:** `gray-900` headings, `gray-700` body, `gray-500` labels/hints.
- **Semantic:** Emerald/green (positive, “You’ll Get”), Amber (neutral highlight, “Total Sale”), Rose/red (caution, “You’ll Give”, danger actions).

### Typography
- **Font:** Plus Jakarta Sans (fallback: Inter, system-ui).
- **Page title:** One per page, class `page-title` → `text-2xl font-bold text-gray-900 tracking-tight`.
- **Section labels:** Class `section-label` → `text-xs font-semibold text-gray-500 uppercase tracking-wider`.
- **Numbers (currency, counts):** `tabular-nums` for alignment.

### Spacing & layout
- **Page padding:** `p-4 md:p-6` on main content; consistent `space-y-6` between major sections.
- **Card padding:** `p-4 md:p-6` for cards; forms use `space-y-4` or `space-y-6`.

### Components (use these classes)
- **Inputs:** `input-base` — rounded-xl, border gray-200, focus ring indigo, padding comfortable.
- **Primary button:** `btn-primary` — indigo-600, rounded-xl, hover lift and shadow.
- **Secondary button:** `btn-secondary` — white, border, hover bg gray-50.
- **Card:** `card` — white, rounded-2xl, light border, soft shadow.
- **Card with hover:** `card-hover` — same as card; on hover: stronger shadow, slight lift (e.g. -translate-y-0.5 or -translate-y-2).
- **Modals:** `modal-overlay`, `modal-center`, `modal-panel`, `modal-header`, `modal-body`, `modal-close-btn`; close on overlay and Escape; panel centered.

### Motion
- **Transitions:** `duration-200` or `duration-300`, `ease-out` or custom easing.
- **Entry:** `animate-fade-in` on page load; `animate-slide-up` (with optional stagger) for cards/lists.
- **Hover:** Subtle lift, shadow increase, or scale(1.02) on buttons/cards; no bouncy effects.

---

## 3. Full responsive rules (all pages)

- **Breakpoints:** Follow Tailwind defaults: `sm` 640px, `md` 768px, `lg` 1024px.
- **Mobile (< 640px):**
  - Single column; stack all grids (e.g. `grid-cols-1`).
  - Full-width buttons and inputs; no tiny tap targets.
  - Tables: either horizontal scroll wrapper (`overflow-x-auto`) or card-style rows (each row a small card).
  - Sticky bottom action bar when needed (e.g. Dashboard: Take Payment, Plus, Add Sale).
  - Sidebar: drawer only; open via hamburger; overlay to close.
- **Tablet (sm/md):**
  - 2-column grids where it helps (e.g. form columns, summary cards).
  - Sidebar can stay collapsible or become permanent per layout.
- **Desktop (lg+):**
  - Sidebar fixed and visible; main content flex-1.
  - Multi-column grids (e.g. 3 cards in a row); tables full width with comfortable column widths.
- **Global:** No horizontal overflow at any viewport; use `min-w-0` on flex children and `overflow-x-auto` only where intentional (e.g. table wrapper).

---

## 4. Page-by-page requirements (regenerate all)

Apply the design system and responsive rules to every page as follows.

### Dashboard
- One `page-title`: “Dashboard”.
- Top: three summary cards in a row (You’ll Get, You’ll Give, Total Sale) — `card-hover`, `section-label`, large number, small icon in rounded container. On mobile: stack vertically.
- Then: search input (with icon) + “New Party” button; then scrollable party list in a `card`.
- Then: desktop action bar (Take Payment, Plus, Add Sale); on mobile, sticky bottom bar with same actions.
- Then: Recent Payments in a `card` with table (or card rows on very small screens).
- FAB or inline Plus opens Quick Actions modal; Take Payment opens Pay Out modal.

### Login
- Centered layout; background same gradient as app.
- Single `card` (max-w-sm), `animate-fade-in`.
- Title “Sign in”, subtitle “Tallin Sales”.
- Form: labels + `input-base` for username and password; error message in a soft red block; submit = `btn-primary` full width.
- Link to Register: indigo, font-medium.

### Register
- Same as Login: centered, one `card`, gradient background.
- Title “Register”, subtitle “Create your Tallin Sales account”.
- All fields with `input-base`; grid for first/last name on larger screens; one primary submit button; link to Sign in.

### Sale History (Invoices list)
- `page-title`: “Sale History”.
- Top: status filter (select with `input-base`) and “New Invoice” `btn-primary`.
- Table inside `card`; header row light bg (e.g. bg-gray-50); row hover state; responsive: `overflow-x-auto` wrapper. Empty state: message + link to create.

### New Sale / Edit Invoice (InvoiceForm)
- `page-title`: “New Sale” or “Edit Invoice”.
- Form in sections inside cards: e.g. “Bill To” and “Invoice Details” in one card; Line items in another (table with add/remove row). Clear/Save in card header or footer.
- Buttons: primary for Save, secondary for Cancel. On mobile, form stacks; table scrolls horizontally if needed.

### Invoice View (InvoiceView)
- `page-title` or document-style title; content in `card` (print-friendly layout). Actions: Print, Share PDF, etc. Responsive: single column, readable font size.

### Items & Stock (Items list)
- `page-title`: “Items & Stock”.
- Search and filters with `input-base`; “Add Item” `btn-primary`.
- Table in `card`, same pattern as Sale History (header, row hover, overflow-x-auto on small screens).

### Item Form (new/edit)
- `page-title`: “Add Item” or “Edit Item”.
- Form in one or two cards; `input-base` for all fields; primary submit, secondary cancel. Stack on mobile.

### Categories
- `page-title`: “Categories”.
- List or table in `card`; add/edit as needed. Same responsive and component rules.

### Payments (list)
- `page-title`: “Payments”.
- Date range and method filters; “Record Payment” button. Table in `card`; same responsive pattern as other lists.

### Payment Form (new/edit) — standalone page
- `page-title`: “Take Payment” or “Edit Payment”.
- Form in one `card`; fields with `input-base`; grid for date/method on larger screens; primary submit, secondary cancel.

### Reports
- `page-title`: “Reports”.
- Tabs or filters for report type; date range; content area in `card`(s). Charts or tables responsive (scroll or stack).

### Account
- `page-title`: “Account”.
- User info and actions in `card`(s); forms if any use `input-base` and same button styles.

### Modals (Quick Actions, Pay Out)
- Use shared modal system: overlay, center, panel; header with title and close (X); body scrollable; Escape and overlay close. Buttons inside follow `btn-primary` / `btn-secondary`; form inputs use `input-base`.

---

## 5. Regenerate-all checklist (per page)

When regenerating or upgrading a page, ensure:

- [ ] **Design system:** Uses only the defined colors, typography, and component classes (input-base, btn-primary, btn-secondary, card, card-hover, page-title, section-label).
- [ ] **Responsive:** Works at 320px, 640px, 768px, 1024px+; no horizontal overflow; tables scroll or become cards on small screens; buttons/inputs full width or appropriately sized on mobile.
- [ ] **One clear title:** Exactly one `page-title` (or equivalent) per page.
- [ ] **Cards:** All major content blocks in `card` or `card-hover` with consistent padding.
- [ ] **Motion:** Transitions on interactive elements; optional fade-in/slide-up on load.
- [ ] **Modals:** If the page has dialogs, they use the shared modal classes and behavior (overlay, center, panel, Escape, close button).
- [ ] **Accessibility:** Focus visible; labels for inputs; semantic structure (headings, landmarks).

---

## 6. One-shot “regenerate all pages” prompt (copy-paste)

Copy the following for an AI or developer to regenerate the entire UI:

---

**Task:** Redesign the Tallin Sales web app UI for a **classy, best-in-class look** and **full responsiveness** across all pages.

**Design system to apply everywhere:**
- Background: light gradient (slate-50 to slate-100). Primary: indigo (buttons, links, active states). Surfaces: white cards, gray-100/200 borders. Typography: Plus Jakarta Sans; page titles `page-title`, section labels `section-label`; tabular-nums for numbers.
- Components: `input-base` (rounded-xl, focus ring), `btn-primary` (indigo, hover lift), `btn-secondary` (border, hover bg), `card` and `card-hover` (rounded-2xl, shadow, hover lift). Modals: overlay + centered panel, close on Escape and overlay, use modal-header/body/close-btn.
- Motion: 200–300ms transitions; optional fade-in/slide-up on load; no bouncy effects.

**Responsive (all pages):**
- Mobile: single column, stacked grids, full-width inputs/buttons, tables in scroll wrapper or card rows, sticky bottom bar if needed, sidebar as drawer.
- Tablet/desktop: multi-column where appropriate, sidebar fixed, no horizontal overflow.

**Pages to regenerate with the above system:**
Dashboard (summary cards, search party, party list, action bar, recent payments), Login, Register, Sale History (Invoices), InvoiceForm (new/edit), InvoiceView, Items & Stock, ItemForm, Categories, Payments list, PaymentForm, Reports, Account. Plus all modals (Quick Actions, Pay Out) using the shared modal pattern.

**Outcome:** Every page uses the same tokens and components, looks classy and consistent, and is fully responsive from 320px to large desktop.

---

*Use this document to drive a full UI regeneration: same design language, same components, and full responsiveness on every page.*
