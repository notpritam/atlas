# Landing navigation exploration

Active phase: mobile/tablet landing navigation. Next: dashboard sidebar on mobile/app, then app colors aligned with the web dashboard. This is a design exploration; the live implementation is unchanged.

## Existing behavior, verified on dev

- 390px and 540px: circular hamburger opens a small absolute-positioned panel over the hero. It contains three section links and Log in; no Start collecting action inside the menu. The menu icon remains a hamburger while open.
- 600px and 768px: both desktop navigation and the menu toggle are hidden. CSS hides desktop navigation at 800px, but only enables the mobile control at 540px. The component also closes the menu above 540px.
- 834px and 1024px: desktop navigation returns. No horizontal page overflow was observed across these six widths.

## Interactive concepts

Open `explore.html`. Assets and fonts are embedded. Switch the style, mobile/tablet size and signed-in state. Close, Menu, Escape and section navigation work. Account and Explore links open the actual dev site in a new tab. The signed-in state is illustrative and does not access an account.

**Recommended: right-side drawer.** Keep the logo and a labeled Menu control in the landing header. A white drawer, at most 390px wide with a visible strip of the page on phones, provides generous section links and a separate Explore public collections link. Anchor Start collecting and Log in at the bottom; use Open my library when signed in. Clear close control, dimmed background, keyboard focus containment and scroll locking. Shared phone/tablet behavior.

**Alternative: header panel.** Use a compact rounded white panel beneath the header, right-aligned on tablet. Same destinations, account actions and accessible dismissal. It retains more scenic context but offers less room for future navigation and small landscape viewports.

Use existing Clarity City/Geist fonts, white surfaces, azure actions and the current bookmark mark. Preserve the landing page's scenic identity. Open with a short transform transition; respect reduced motion.

## Implementation considerations after selecting a direction

- Unify CSS and JavaScript navigation breakpoints. A practical proposed cutoff is 1024px, with the full header above it; validate content fit around the cutoff before release.
- Keep section links and real destinations accessible, with a reliable fallback before JavaScript loads.
- Provide 48px or larger targets, accessible naming, Escape/backdrop dismissal, focus restoration and adequate scrolling on short screens.
- Test anonymous/signed-in states, 320px phones, tablet portrait/landscape, short viewport heights and keyboard access.
- Deploy the selected implementation to the existing dev environment for testing.
