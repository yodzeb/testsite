# Éditeur du site

Application locale (Python + Flask) pour gérer le site sans toucher aux fichiers : articles, réalisations, pages, menu, images, aperçu et publication (Git intégré).

## Démarrage

Prérequis : **Python 3.9 ou plus** et **Git** installés sur l'ordinateur.

| Système | Lancement |
| --- | --- |
| Windows | double-clic sur `Lancer-editeur.bat`, ou clic droit sur `Lancer-editeur.ps1` → « Exécuter avec PowerShell » |
| macOS | double-clic sur `lancer-editeur.command` |
| Linux | `./lancer-editeur.command` ou `python3 tools/editor/run.py` |

Au premier lancement, l'éditeur installe ses composants (1 à 2 minutes, connexion Internet nécessaire). Ensuite, il démarre en quelques secondes et ouvre le navigateur sur une adresse du type `http://127.0.0.1:5173/`. **Laissez la fenêtre noire ouverte** pendant que vous travaillez ; fermez-la pour quitter.

L'éditeur n'est accessible que depuis votre ordinateur.

## Utilisation

- **Articles / Réalisations** : « + Nouvel·le » crée un brouillon. Le formulaire à gauche contient titre, date, résumé, tags, image de couverture ; le texte s'écrit à droite en Markdown avec l'aperçu en direct. `Ctrl+S` (ou `Cmd+S`) enregistre.
- **Éléments d'un article** : sur-titre, titre et chapo se saisissent dans le bloc en haut de la zone de rédaction. Dans le texte : bouton **Intertitre** (`Ctrl+Alt+H`), bouton **Photo + légende** (`Ctrl+Alt+P`, avec crédit photo affiché en petit), plus `Ctrl+B` gras, `Ctrl+I` italique, `Ctrl+K` lien, `Ctrl+Alt+Q` citation, `Ctrl+Alt+L` liste, `Ctrl+Alt+N` liste numérotée, aussi dans les textes des sections (sur Mac : `⌘`). Le bouton **?** en bas à droite ouvre l'aide.
- **Images** : glissez-les dans la zone « Images » ou dans le texte, ou collez-les depuis le presse-papiers. L'éditeur les range à côté de l'article, réduit les trop grandes photos (2400 px maximum) et demande une description (accessibilité). Boutons : *Insérer* dans le texte, *Couverture*, supprimer.
- **Brouillon** : décochez « Brouillon » pour que l'article soit publié.
- **Thèmes, format, contenus liés** : cochez les thèmes (randonnée, lifestyle, culture, économie…, nouveaux thèmes possibles), choisissez le format (texte, vidéo, podcast) et les contenus « Voir aussi ». Les contenus de mêmes thèmes sont aussi proposés automatiquement en bas de chaque page.
- **Vidéos** : renseignez l'adresse YouTube dans le champ « Vidéo YouTube » (affichée en haut de l'article), ou utilisez le bouton **Vidéo…** de la barre d'outils pour en insérer une dans le texte. La vidéo ne se charge qu'au clic (aucun cookie avant).
- **Mises en page** : « Standard », « Sections (défilement progressif) » ou, pour une réalisation, « Étude de cas ». Avec les sections, un constructeur apparaît : ajoutez des blocs (texte, grande image, vidéo YouTube en lecteur ou en fond, citation, galerie, texte + image), réordonnez-les avec ↑ ↓. Disponible aussi pour l'accueil et les pages (Pages > Accueil, À propos…). Les animations sont désactivées pour les visiteurs qui ont demandé « réduire les animations ».
- **Apparence** : modèle de départ (Magazine, Minimal, Chaleureux, Éditorial), couleurs, polices, arrondi, boutons, mode clair/sombre, logo et icône. Aperçu en direct ; « Enregistrer l'apparence » écrit dans `hugo.toml`.
- **Pages** : accueil, À propos, mentions légales, etc.
- **Menu et réglages** : nom du site, e-mail, réseaux sociaux, ordre et liens du menu.
- **Aperçu du site complet** : construit le vrai site avec Hugo et l'ouvre dans un nouvel onglet (brouillons inclus). Hugo est **téléchargé automatiquement** la première fois s'il n'est pas installé (dans `.tools/`, jamais envoyé sur GitHub).
- **Publier** : voir la liste des fichiers modifiés, saisir une description et cliquer sur « Publier sur le site » (enregistre les modifications et les envoie sur GitHub ; le site est en ligne 1 à 2 minutes plus tard). « Récupérer les changements en ligne » met à jour votre copie si le dépôt a été modifié ailleurs.
- **Revenir à une version précédente** : sous le bouton de publication, « Historique des versions » liste chaque publication (date, description, fichiers modifiés). « Revenir à cette version » remet le site dans cet état en créant une **nouvelle** version : rien n'est effacé, et le retour peut lui-même être annulé de la même façon. Il faut d'abord publier les modifications en cours.

## Première publication : identité et connexion GitHub

1. À la première publication, l'éditeur demande votre **nom et e-mail** (simple signature des modifications).
2. L'envoi sur GitHub demande d'être connecté·e : avec Git pour Windows ou macOS, une fenêtre de connexion GitHub s'ouvre au premier envoi. Le dépôt doit avoir été cloné en **HTTPS** (`https://github.com/…`) ou avec une clé SSH configurée.

## Pour les développeurs

- Code : `app.py` (API), `static/` (interface). Les champs des formulaires se définissent dans `COLLECTIONS` en haut de `app.py`.
- Les contenus sont de simples fichiers Markdown : l'éditeur et l'édition à la main sont interchangeables.
- Version de Hugo téléchargée automatiquement : `HUGO_VERSION` dans `app.py` (à garder identique à `.github/workflows/pages.yml`).
