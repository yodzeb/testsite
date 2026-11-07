# Site de journaliste / pigiste

Site statique en français, généré avec [Hugo](https://gohugo.io) et publié sur GitHub Pages par GitHub Actions. Tout le contenu s'écrit en Markdown : il n'y a rien à compiler soi-même.

## Éditeur graphique (recommandé)

Un éditeur local permet de tout gérer sans toucher aux fichiers : articles, réalisations, images, menu, aperçu et publication. Lancez `Lancer-editeur.bat` (Windows), `lancer-editeur.command` (macOS) ou `Lancer-editeur.ps1` (PowerShell). Détails : [tools/editor/README.md](tools/editor/README.md).

## Comment modifier le site (à la main)

Chaque modification se fait en éditant un fichier, directement sur github.com (bouton ✏️) ou en local, puis en validant (commit) sur la branche `main`. Le site est reconstruit et publié en 1 à 2 minutes.

| Je veux…                         | Je modifie…                                          |
| -------------------------------- | ---------------------------------------------------- |
| Changer le nom, le menu, les liens sociaux, l'e-mail | `hugo.toml`                      |
| Modifier la page d'accueil       | `content/_index.md`                                  |
| Modifier « À propos », « Contact » | `content/a-propos.md`, `content/contact.md`        |
| Écrire un article                | créer `content/blog/AAAA-MM-mon-titre.md`            |
| Ajouter une réalisation au book  | créer un dossier `content/book/mon-projet/` avec un `index.md` |
| Changer les couleurs, les polices | `assets/css/main.css` (variables en haut du fichier) |
| Compléter les mentions légales   | `content/mentions-legales.md`                        |

### Écrire un article

Créez `content/blog/2026-06-mon-article.md` :

```markdown
---
title: "Titre de l'article"
date: 2026-06-15
description: "Résumé court (aperçu, moteurs de recherche, réseaux sociaux)"
tags: ["société", "enquête"]
image: couverture.jpg        # facultatif
draft: false                 # true = brouillon, non publié
---

Le texte en **Markdown**…
```

- Avec des images : créez un dossier `content/blog/2026-06-mon-article/` contenant `index.md` et les photos. Référencez-les par leur nom : `![Légende](photo.jpg)`.
- Un article **daté dans le futur** n'est pas publié ; il apparaît automatiquement à sa date (le site est reconstruit chaque nuit).
- Les `tags` créent des pages de thèmes automatiquement.

### Ajouter une réalisation au book

Copiez un dossier d'exemple de `content/book/`, renommez-le, puis modifiez `index.md` :

```markdown
---
title: "Titre de la réalisation"
date: 2026-02-01
description: "Une phrase de présentation"
media: "Nom du média ou du client"
role: "Votre rôle"
categorie: "Enquête"          # sert aux filtres de la page Book
lien: "https://…"             # lien vers l'original (facultatif)
image: couverture.jpg         # vignette (facultatif)
---

Texte de présentation, contexte, retombées…
```

Toutes les images du dossier apparaissent dans une galerie avec visionneuse. Les PDF du dossier sont listés comme documents à télécharger.

### Menu

Dans `hugo.toml`, section `[[menus.main]]` : une entrée par lien (`name`, `pageRef`, `weight` pour l'ordre).

## Vidéos, thèmes, mises en page

- **Thèmes** : `themes: ["randonnée", "culture"]` dans l'en-tête d'un article ou d'une réalisation. Chaque thème a sa page (`/themes/culture/`), et le book se filtre par thème et par format.
- **Format** : `format: "texte"`, `"video"` ou `"audio"` (étiquette sur les vignettes). `video: "https://www.youtube.com/watch?v=…"` affiche un lecteur lu au clic ; `audio: "fichier.mp3"` (placé dans le dossier de l'article) affiche un lecteur audio. Dans le texte : `{{< video url="https://www.youtube.com/watch?v=…" >}}`.
- **Voir aussi** : `liens: ["blog/mon-article.md", "book/ma-realisation/index.md"]`, complété automatiquement par les contenus de mêmes thèmes.
- **Mise en page par sections** : `mise_en_page: sections` (ou `etude` pour une réalisation) et une liste `sections:` (types : `texte`, `image`, `video`, `citation`, `galerie`, `colonnes`). Voir `content/book/enquete-exemple/index.md` pour un exemple complet ; l'éditeur graphique propose un constructeur de blocs.
- **Apparence** : section `[params.theme]` de `hugo.toml` (couleurs, polices, arrondi, logo…), réglable depuis l'écran « Apparence » de l'éditeur.

## Adresse du site (domaine personnalisé)

Les liens du site utilisent l'adresse fournie par GitHub Pages au moment de la publication, qui tient compte du domaine personnalisé déclaré dans Settings → Pages. Pour la forcer (par exemple si le domaine n'est pas déclaré là), créez la variable de dépôt `SITE_URL` (Settings → Secrets and variables → Actions → Variables) avec une valeur comme `https://www.mon-domaine.fr`, puis relancez la publication.

## Mise en ligne (une seule fois)

1. Sur GitHub : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. Poussez sur `main`. L'onglet **Actions** montre la publication ; l'adresse du site s'affiche à la fin.
3. Domaine personnalisé (facultatif) : renseignez-le dans Settings → Pages et configurez le DNS chez votre registrar.

## Formulaire de contact

Créez un formulaire gratuit sur [formspree.io](https://formspree.io), puis collez son adresse dans `hugo.toml` (`formspree = "https://formspree.io/f/…"`). Sans cela, la page Contact affiche un lien e-mail.

## Prévisualiser en local (facultatif)

Installez [Hugo extended](https://gohugo.io/installation/) (version 0.147 ou plus récente), puis :

```bash
hugo server
```

Le site est alors visible sur http://localhost:1313. La recherche n'est disponible qu'après publication.

## Structure

```
hugo.toml                # configuration, menu
content/                 # tout le contenu (Markdown + images)
assets/                  # CSS et JavaScript
layouts/                 # modèles HTML (à modifier seulement pour une refonte)
static/                  # fichiers copiés tels quels (favicon, images globales)
.github/workflows/       # publication automatique
```
