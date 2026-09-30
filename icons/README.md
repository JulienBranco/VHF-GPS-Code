# Icône VHF GPS — proposition B validée

Dessin choisi par l’utilisateur : radio VHF devant une carte marine, route en pointillés et repère jaune.

La source actuelle est **radio-carte-source.png**. Elle a été créée avec l’outil intégré de génération
 d’images, puis adaptée avec ce même outil à un fond carré opaque. Palette : bleu marine, blanc,
 turquoise et jaune. Aucun texte dans le dessin.

- `icon-192.png`, `icon-512.png` : découpe ronde, coins transparents.
- `icon-maskable-192.png`, `icon-maskable-512.png` : fond opaque avec une marge supplémentaire de 15 %.
- `apple-touch-icon.png` : 180 × 180, fond opaque pour iPhone.

Le téléphone choisit la forme finale de l’icône adaptative. Les courbes de carte sont décoratives
 et peuvent être coupées par le masque. La marge protège la radio et le repère au centre.

Pour reproduire les exports à partir de la source, après l’installation des outils de test :

```powershell
npm run icons:export
```

L’export utilise le canvas de Chromium pour les dimensions, la découpe ronde et la marge.
Il ne redessine pas l’image. Ensuite, `node tools/build.cjs` actualise le cache du launcher.
Les modifications d’icônes seules ne créent pas de nouvelle release du moteur.

## Prompt de la proposition B

Use case: logo-brand. Asset type: preview proposal for a round PWA icon for VHF GPS, a fishermen's marine radio GPS position exchange app. Generate ONE square image with a centered circular deep navy blue badge on pale warm-gray background. Main idea: a bold off-white handheld marine VHF radio in the foreground, unmistakable short antenna, two knobs, large speaker, tiny blank screen; behind it a simplified nautical chart with only three broad turquoise sea contour curves, a short plotted route and a small amber location point. Composition is unified and very simple, legible at 48 pixels. Style: sophisticated flat vector-like app icon with thick rounded geometric shapes, crisp edges and strong contrast. Palette navy #09202a, off-white #f6fffc, turquoise #65ddbd, just one tiny amber #ffc566 accent. The chart is suggestive, not a detailed real map. All antenna tips and important details contained inside a central circle of radius 38% of the badge width for adaptive-icon cropping. No text, letters, numbers, generic globe, watermark, glossy effect, 3D, mockup or extra border. One large straight-on circular icon only.

## Prompt de l’adaptation finale

Edit the provided icon B for final deployment as a PWA app icon. Preserve its exact chosen design: the off-white marine handheld VHF radio with antenna and two knobs, turquoise nautical contour lines, white dashed route and single amber position dot. Preserve palette, stroke weight, proportions and arrangement; do not introduce a different radio or new symbols. Change only production framing: eliminate ALL pale cream/gray background outside the navy circular badge and replace it with the same navy background extending seamlessly to every edge and corner of the SQUARE image. The final image must be fully opaque, with no visible circular boundary, frame, border or surrounding mockup. Center the illustration and adjust padding only enough that the ENTIRE radio, including antenna tip, plus dashed route and amber dot, fit inside a centered safe circle of radius 37% of image width. The decorative map contour curves may extend into the outer area. Keep the symbol prominent and readable, no excessive empty space. Render a clean, crisp high-resolution square master, no text, labels, watermark, added shine, gradients, texture or shadow. This is a faithful technical adaptation of the selected icon, not a redesign.

La marge supplémentaire est appliquée à l’export adaptatif pour respecter la zone protégée.
