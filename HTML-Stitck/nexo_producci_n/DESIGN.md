---
name: Nexo Producción
colors:
  surface: '#f6f9ff'
  surface-dim: '#c8dcf0'
  surface-bright: '#f6f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#ecf5ff'
  surface-container: '#e1f0ff'
  surface-container-high: '#d6ebff'
  surface-container-highest: '#d0e5f9'
  on-surface: '#081d2c'
  on-surface-variant: '#43474f'
  inverse-surface: '#1f3242'
  inverse-on-surface: '#e6f2ff'
  outline: '#737780'
  outline-variant: '#c3c6d1'
  surface-tint: '#3a5f94'
  primary: '#001e40'
  on-primary: '#ffffff'
  primary-container: '#003366'
  on-primary-container: '#799dd6'
  inverse-primary: '#a7c8ff'
  secondary: '#4b6700'
  on-secondary: '#ffffff'
  secondary-container: '#bbf23d'
  on-secondary-container: '#4f6c00'
  tertiary: '#002416'
  on-tertiary: '#ffffff'
  tertiary-container: '#003c27'
  on-tertiary-container: '#00b27b'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d5e3ff'
  primary-fixed-dim: '#a7c8ff'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#1f477b'
  secondary-fixed: '#bef440'
  secondary-fixed-dim: '#a3d71f'
  on-secondary-fixed: '#141f00'
  on-secondary-fixed-variant: '#384e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f6f9ff'
  on-background: '#081d2c'
  surface-variant: '#d0e5f9'
typography:
  display-lg:
    fontFamily: Rubik
    fontSize: 2.25rem
    fontWeight: '800'
    lineHeight: 2.75rem
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Rubik
    fontSize: 1.75rem
    fontWeight: '800'
    lineHeight: 2.25rem
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Rubik
    fontSize: 1.375rem
    fontWeight: '800'
    lineHeight: 1.875rem
    letterSpacing: -0.01em
  title-md:
    fontFamily: Rubik
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
  body-lg:
    fontFamily: Rubik
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Rubik
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  data-tabular-lg:
    fontFamily: Rubik
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: 0.01em
  data-tabular-md:
    fontFamily: Rubik
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: 0.01em
  label-md:
    fontFamily: Rubik
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
    letterSpacing: 0.04em
  label-sm:
    fontFamily: Rubik
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system delivers an industrial, high-density operations and business intelligence interface built for plant directors, production planners, and logistics leads. The aesthetic blends **Corporate Modern** rigor with **Tactile Industrial Precision**: clean structural divisions, high contrast, non-distracting backgrounds, and crisp typographic hierarchy tailored for quick telemetry scanning.

The experience is centered on data density, operational certainty, and swift decision-making under time constraints. Superfluous gradients, blurred backdrops, and decorative clutter are eliminated in favor of clean information architecture, strict line-based borders, and immediate status recognition.

## Colors

The palette is engineered for high-throughput enterprise decision-making, using color strictly to guide focus, signify status, and anchor brand continuity.

- **Primary (`#003366`)**: Deep Industrial Blue. Used for persistent navigation, primary application headers, top-tier table headers, and focused states.
- **Secondary (`#95C800`)**: Vibrant Lime Green. Reserved for high-value affirmative actions, key performance indicators beating target, and production release actions.
- **Surface & Backgrounds**:
  - Global canvas: `#F4F6F8` (neutral light stone).
  - Module cards & table bodies: `#FFFFFF`.
  - Secondary containers & subtle row striping: `#EDF2F7`.
- **Text & Hierarchy**:
  - Primary text: `#172B3A` (slate black).
  - Secondary text / metadata: `#64748B` (slate gray).
  - Subtle / muted placeholders: `#94A3B8`.
- **Structural Lines**:
  - Borders and column separators: `#DCE3EA`.
- **Functional Semantics**:
  - Critical / Shortages / Alerts: `#EF4444` (fill), `#DC2626` (emphasis/text).
  - Warning / Risk / Pending Dispatch: `#F59E0B`.
  - Available / Goal Achieved: `#10B981` (standard functional green) and `#95C800` (accent brand green).

## Typography

The typographic system utilizes **Rubik** exclusively across all levels. 

- **Display & Main Section Headers**: Set in **Rubik ExtraBold Italic** (`800 Italic`) to reflect the speed, dynamism, and corporate identity of the master brand.
- **Card Titles & Subheadings**: Set in **Rubik SemiBold** (`600 Normal`) for instant readability without overpowering data.
- **Tabular Data & Telemetry**: Quantitative cells, Profit sync codes, order IDs, and lot quantities must enforce `font-variant-numeric: tabular-nums` to guarantee vertical column alignment across wide matrices.
- **Micro-labels & Status Indicators**: Set in uppercase **Rubik SemiBold** (`0.75rem`) with generous tracking (`0.04em`) to ensure legibility on low-resolution shop-floor screens.

## Layout & Spacing

A compact, dense grid structure is used to optimize vertical screen efficiency for enterprise dashboards and operational spreadsheets.

- **Grid Strategy**: Fluid 12-column grid layout across desktop environments with tight 16px to 24px gutters.
- **Table Density**: Data row heights must maintain a strict 36px–40px standard height for high throughput, expanding to 48px only when inline micro-charts or multi-line metadata are present.
- **Component Padding**: Internal card padding uses `space-lg` (16px), while dense filter panels and toolbars use `space-sm` to `space-md` (8px to 12px) to minimize vertical scroll requirements.
- **Responsive Adaptations**:
  - *Desktop (≥1280px)*: Full 12 columns, dual-pane production and dispatch side-by-side matrices.
  - *Tablet (768px - 1279px)*: Collapsible navigation sidebar, stacked grid modules, horizontally scrollable data tables with fixed left identifier columns.
  - *Mobile (<768px)*: Single-column KPI cards, full-bleed data listings with expanded tap targets.

## Elevation & Depth

This system avoids heavy shadows, blur filters, or artificial skeuomorphism in favor of **structural containment** and **low-contrast outline separation**:

- **Surfaces**: Elevation is conveyed through surface value differences: Canvas (`#F4F6F8`) vs. Work Containers (`#FFFFFF`) vs. Secondary Well panels (`#EDF2F7`).
- **Borders & Dividers**: All cards, data cells, modal dialogues, and sidebars utilize a sharp 1px border (`#DCE3EA`). No borderless floating elements.
- **Functional Shadows**:
  - Resting cards: No shadow, 1px border.
  - Floating dropdowns, contextual filters, and date pickers: `box-shadow: 0 4px 12px -2px rgba(23, 43, 58, 0.08), 0 2px 6px -1px rgba(23, 43, 58, 0.04)`.
  - Active dragged Gantt/production blocks: `box-shadow: 0 8px 20px -4px rgba(0, 51, 102, 0.16)`.

## Shapes

The design uses **Soft (0.25rem / 4px)** geometry (`roundedness: 1`). 

- Default interactive controls (inputs, buttons, select fields, table filters): `rounded` (4px).
- Status badges, metric cards, and dialog boxes: `rounded-lg` (8px).
- Fully circular radii (`rounded-full`) are strictly restricted to avatars, step indicators, and small numeric icon badges.
- Sharp rectangular precision is prioritized in enterprise table headers and layout grid separators to maintain a professional, industrial demeanor.

## Components

### Buttons
- **Primary Action (Commit / Plan / Release)**:
  - Background: `#003366`, Text: `#FFFFFF`, Weight: `600`, Border: none, Border-radius: `4px`.
  - Hover: `#002244`, Focus: ring 2px `#95C800`.
- **Secondary / Positive Action (Approve / Confirm Available)**:
  - Background: `#95C800`, Text: `#172B3A`, Weight: `700`, Border: none, Border-radius: `4px`.
  - Hover: `#84B300`.
- **Outline / Neutral**:
  - Background: `#FFFFFF`, Text: `#172B3A`, Border: `1px solid #DCE3EA`.
  - Hover: `#F4F6F8`.

### Data Grid & Tables
- **Header**: Background `#003366`, Text `#FFFFFF`, Font: `0.75rem`, Uppercase, Weight `600`.
- **Rows**: Alternating background (`#FFFFFF` and `#FAFCFD`). Border bottom: `1px solid #DCE3EA`.
- **Cell Typography**: Tabular numerals enabled (`font-variant-numeric: tabular-nums`). Right-aligned numbers, left-aligned alphanumeric keys and SKU codes.
- **Hover**: Background `#F0F4F8`.

### Badges & Status Chips
- **Shortage / Critical Alert**: Background `#FEF2F2`, Text `#DC2626`, Border: `1px solid #FECACA`.
- **Risk / Warning / Delay**: Background `#FFFBEB`, Text `#B45309`, Border: `1px solid #FDE68A`.
- **Fulfilled / In Stock**: Background `#F0FDF4`, Text `#15803D`, Border: `1px solid #BBF7D0`.
- **Profit Sync Status**: Background `#F4F6F8`, Text `#172B3A`, Border: `1px solid #DCE3EA` with green/amber pulse dot indicator.

### Input Fields & Selectors
- Standard height: 36px.
- Background: `#FFFFFF`, Border: `1px solid #DCE3EA`, Text: `#172B3A`, Font: `0.875rem`.
- Focus: Border color `#003366` with a soft `0 0 0 1px #003366` box shadow.
- Invalid state: Border color `#EF4444`.

### Operational Metric Cards (KPIs)
- Background: `#FFFFFF`, Border: `1px solid #DCE3EA`, Padding: `16px`.
- Title: Label uppercase `#64748B` (`0.75rem`).
- Value: Rubik Bold (`1.75rem`, `#172B3A`, tabular numerals).
- Trend Indicator: Top-right or below value, colored `#95C800` (positive) or `#EF4444` (negative).