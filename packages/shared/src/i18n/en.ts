import type { TranslationSchema } from './zh-CN';

/**
 * English strings.
 *
 * Typed against {@link TranslationSchema}, so **a missing or misspelled key is a
 * compile error** — that is how "没有漏译" in the M1 acceptance criteria is enforced
 * mechanically rather than by eyeballing.
 */
export const en: TranslationSchema = {
  common: {
    appName: 'MCSR Helper',
    loading: 'Loading…',
    retry: 'Retry',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    submit: 'Submit',
    search: 'Search',
    empty: 'Nothing here yet',
    error: 'Something went wrong',
    backHome: 'Back to home',
  },
  nav: {
    /*
     * ★ "Reorder it yourself" (2026-09-17; the user asked for the sidebar sections
     *   to be reorderable). This is the **accessible name** of the drag handle.
     * ⚠️ `{{name}}` is that section's own name (another key in this same `nav.*`):
     *   a screen reader then says "Reorder Resources" instead of a row of
     *   identical "Reorder" buttons that never say *what* they reorder.
     * ⚠️ `sections: 'SECTIONS'` used to sit here: it was the text of the small
     *   group heading, and the same request said to remove it ("去掉顶部的
     *   『分区』这些字") ⇒ the heading is gone and the key is deleted from **both**
     *   dictionaries. `services/api/src/i18n-keys.test.ts` checks that the two
     *   dictionaries line up and that every literal `t('…')` key exists -- it has
     *   **no** "unused key" rule, so keeping this one would stay green while
     *   leaving the next reader thinking the heading is still on screen.
     */
    reorder: 'Reorder "{{name}}"',
    /*
     * ⚠️ This is the handle's tooltip, and it has to name **both** routes: dragging
     *   (mouse) and ↑ / ↓ (keyboard). Saying only "drag" leaves keyboard users
     *   with no idea what the button does.
     * ⚠️ Only ↑ / ↓: the font subset carries exactly four arrows, U+2190-2193
     *   (↕ / ⇅ / ⠿ are NOT in it -- `check-font-coverage` would go red). Same
     *   constraint as the ← / → on the collapse button.
     */
    reorderHint: 'Drag to reorder; with it focused, press ↑ / ↓ to move it up or down',
    collapse: 'Collapse',
    expand: 'Expand',
    resources: 'Resources',
    calendar: 'Calendar',
    seeds: 'Ranked seeds',
    /*
     * ⚠️ This key points at the `/videos` section, whose name is "Videos".
     * The key keeps the name `videos` because the route is still `/videos`;
     * changing the value rather than the key avoids a repo-wide rename that
     * would miss somewhere.
     *
     * ⚠️★ 2026-09-14: the user asked for it to go **back to "Videos"** ("the left
     * sidebar's Entertainment videos should read Videos"). It had been renamed to
     * "Entertainment videos" when Live was split out, to keep the two apart in
     * the sidebar. But a section may only have ONE name: renaming just the
     * sidebar row leaves the page itself headed "Entertainment videos" -- and
     * this repo already recorded that exact mistake once (see the note at
     * `videos.title`). So the section's own name (sidebar, page title, "see all")
     * is now "Videos", and prose says "the Videos section".
     */
    videos: 'Videos',
    live: 'Live',
    /*
     * ★ "Now sharing" -- deliberately NOT "Live sharing": `nav.live` is already
     *   "Live", and two Live rows in one sidebar read as a duplicate section.
     *   The two sections really are different jobs: Live is a slow, public list
     *   of streamers maintained by editors; this one is what signed-in users put
     *   up for a few minutes.
     */
    shares: 'Now sharing',
    /*
     * ★ "Ranked now" (2026-09-16). The **sidebar row** lands in Task 7 (it has to
     *   come after the `/ranked` route: `homerender.tsx` guards that a clickable
     *   section has a real route in `App.tsx`).
     * ⚠️★ The **string** has to exist now, though: `components/RankedPanels.tsx`
     *   renders its page title with `t('nav.ranked')`, and
     *   `services/api/src/i18n-keys.test.ts` scans source for literal call sites
     *   and asserts the key exists in this dictionary -- landing it later leaves
     *   `pnpm -w check` red between Task 5 and Task 7.
     * ⚠️ Not "Ranked live" / "Live": the sidebar's Live row is already "Live",
     *   and this repo spent a round on two Live rows meaning different sections
     *   (the same note sits on `nav.shares`).
     */
    ranked: 'Ranked now',
    /*
     * ★ "File updates" (2026-09-24) — checking and updating local files, a
     *   **desktop-only** capability.
     * ⚠️ Its sidebar position is just **above** "Profile" (`lib/nav.ts`), so this
     *   entry sits between `ranked` and `profile` too: the names (here) and the
     *   order (`NAV_SECTIONS`) are two tables, kept in the same reading order so
     *   the next person adding a section can see where it goes.
     * ⚠️ Not "Local files" / "Mods": the page covers the bound mod jars **and**
     *   the catalog, and "file updates" is the phrase the section is built on.
     */
    files: 'File updates',
    profile: 'Profile',
    admin: 'Admin',
    submit: 'Submit',
    review: 'Review',
    login: 'Log in',
    register: 'Sign up',
    logout: 'Log out',
    language: 'Language',
    /* Theme switch (2026-09-13). */
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
  },
  home: {
    tagline: 'Resource hub and calendar for the MCSR community',
    subtitle: 'Websites, tools, events and seeds — all in one place.',
    /*
     * ⚠️ No longer referenced (a placeholder from the M0 skeleton).
     *    It is deliberately **left in place**: the home page is being turned into
     *    "what each section is + a connectivity check", and that sentence
     *    belonged to the two cards being removed. Keeping it costs one unused
     *    entry; the comment is here so the next reader knows why it survived
     *    (an orphan entry with no note is what this repo keeps warning about).
     */
    comingSoon: 'We are at the M0 skeleton stage. Features are under construction.',

    /*
     * -------------------------------------------------------------------------
     * Home page rework (2026-09-14, user request)
     * -------------------------------------------------------------------------
     * "Drop the 资源库 block and the two cards under it; replace them with
     *  one-line descriptions of the sections (same ones as the sidebar) and a
     *  connectivity check for the page and the API."
     *
     * ⚠️ The section **names** are not here — those are `nav.*`, the very entries
     *    the sidebar uses. Duplicating a name is how one section ends up with two
     *    of them, which this repo just spent a round fixing (「娱乐视频」/「视频」).
     */
    sectionsTitle: 'What is on this site',
    sectionsHint: 'Those entries on the left are the whole site. Here is what each one is for.',
    desc: {
      resources:
        'Websites, tools and tutorial videos the community collected — filter by kind and tag.',
      calendar:
        'The schedule for tournaments, community events and ranked seasons. Filter by tag, level, scope and entry requirement.',
      videos:
        'Bilibili / YouTube videos people posted — tutorials, montages, match recordings. Post it and it is visible; nothing to review.',
      live: 'A slow-moving list of MCSR streamers, maintained by the editors — a different job from the post-and-go section above.',
      /*
       * ⚠️ This entry is mandatory: the home page looks each row's description up
       *    by the section's `block` name (`home.desc.<block>`), so a nav row
       *    without it prints a raw key on the home page (`check:home` goes red).
       *    It has to say the two things that make this section different —
       *    short-lived, and behind a login.
       */
      shares:
        'Room codes and world seeds people put up for a few minutes — they vanish on their own, and you have to log in to see inside.',
      seeds: 'Search world seeds, and see the ones people shared along with their times.',
      /*
       * ⚠️ This entry and the sidebar row (`lib/nav.ts`, `block: 'ranked'`) have to
       *    land in the same commit: `check:home` checks the correspondence in both
       *    directions -- without this line the home page prints a raw key, and
       *    with this line but no nav row it is equally red (measured earlier:
       *    dictionary-only, `check:home` exits 1).
       * ⚠️ The wording follows the section's four tabs (status and count / live
       *    matches / leaderboard / weekly race) rather than "an intro to MCSR
       *    Ranked": this section answers what is happening right now, and a
       *    blurb that reads like an explainer points at a page that does not exist.
       */
      ranked:
        'Who is playing right now: live matches, online count, leaderboards and the weekly race.',
      /*
       * ⚠️ This line is required by `block: 'files'` in `lib/nav.ts` (the home
       *    page looks each row up by `home.desc.<block>`; without it the page
       *    prints a raw key and `check:home` goes red).
       * ⚠️ The wording says "are current" and **avoids "auto-update"**: writing
       *    files always takes a click, and that phrase reads as "it will change
       *    my files by itself" (the page's `files.autoHint` exists to clear that
       *    up, and a one-line home row has no room to do it).
       */
      files: 'Check whether your local mods are current',
      profile:
        'Your account: sign-in state, email verification, what you posted and what you saved.',
    },

    /*
     * -------------------------------------------------------------------------
     * Connectivity (page + API)
     * -------------------------------------------------------------------------
     * ⚠️★ The one thing this must never do is lie:
     *    · the "page" row measures whether **this page rendered** (if you can read
     *      the row, it did), so it must carry a **measured number** (time to first
     *      paint). A green "OK" with no number is decoration.
     *    · the "API" row really **issues a request** (`GET /api/health`); green only
     *      on success, and a failure prints the error rather than staying grey.
     *    ⚠️ No polling and no auto-retry: this is not a monitoring dashboard, and
     *      an automatic retry would quietly erase the moment it was unreachable.
     */
    statusTitle: 'Connectivity',
    statusHint: 'The right column is measured **while you watch** — not a hard-coded status.',
    statusWeb: 'This page',
    statusApi: 'API',
    statusOk: 'OK',
    statusFail: 'Unreachable',
    statusChecking: 'Checking…',
    /** The number on the "page" row: time to first paint, in milliseconds. */
    webLoaded: 'Loaded in {{ms}} ms',
    webNote: 'Being able to read this row is itself the evidence that the page loaded.',
    /** The number on the "API" row: the API version and this request's round trip. */
    apiVersion: '{{version}}',
    apiRoundTrip: '{{ms}} ms round trip',
    apiEndpoint: 'GET /api/health',
    apiNote: 'Your browser really did just call the backend for this.',
  },
  status: {
    draft: 'Draft',
    pending: 'Pending review',
    published: 'Published',
    rejected: 'Rejected',
    hidden: 'Hidden',
  },
  seed: {
    label: 'World seed',
    placeholder: 'e.g. 306404093549845300',
    invalid: 'Not a valid Minecraft seed (must be a 64-bit integer; negatives are allowed)',
    hint: 'Seeds are stored as strings verbatim, so precision is never lost.',
  },
  resources: {
    submitAction: 'Submit one',
    title: 'Resources',
    subtitle: 'Websites, tools and references collected by the community — no sign-in needed.',
    searchPlaceholder: 'Search titles, summaries or tags…',
    searchLabel: 'Search',
    tabAll: 'All',
    tabWebsite: 'Websites',
    tabTool: 'Tools',
    /*
     * ① The video sub-tab.
     *
     * ⚠️ Deliberately different from `kindVideo` ("Video resource") — two
     *    different positions, not two sources of truth:
     *      · this one is a short tab label sitting next to "Websites"/"Tools";
     *      · `kindVideo` is the type badge on a card, and it must stay longer
     *        because it has to distinguish this from /videos (entertainment).
     *    Both are driven by the same `video` kind value.
     */
    tabVideo: 'Videos',
    allKinds: 'All types',
    allLangs: 'All languages',
    kindWebsite: 'Website',
    kindTool: 'Tool',
    /*
     * "Video resource" — a resource-library entry type.
     *
     * ⚠️ Not the same thing as the "Videos" section, and the
     * wording has to keep them apart: a video *resource* goes through
     * submit → review → tags ("this video is worth cataloguing"), while that
     * section is post-and-it-is-visible ("this video is fun"). Both are videos;
     * one is reference material, the other is content.
     */
    kindVideo: 'Video resource',
    langZh: 'Chinese',
    langEn: 'English',
    resultCount: '{{count}} entries',
    resultCountFiltered: '{{count}} matching',
    noResults: 'Nothing matches',
    noResultsHint: 'Try a different keyword, or clear the filters.',
    clearFilters: 'Clear filters',
    featured: 'Featured',
    official: 'Official',
    visit: 'Open link',
    backToList: 'Back to resources',
    lastUpdated: 'Last updated {{date}}',
    tagsLabel: 'Tags',
    subTagsLabel: 'Category tags',
    tagFilterHint: 'Filter by tag:',
    /*
     * Deleting a tag (2026-09-17; user request: "editors may delete resource-library
     * tags; the resources that carried a deleted tag stay, only the tag goes away").
     *
     * ⚠️ These only ever reach editors (`resource.moderate`: editor / admin / owner) —
     *    the × button, the confirm step and the result line all live in
     *    `components/TagCloud.tsx`, gated by `useCan('resource.moderate')`.
     *
     * ⚠️ Two things the wording must keep straight: how many resources this touches,
     *    and that **the resources themselves stay** (the user asked for exactly that;
     *    "delete the tag" reads like "delete the entries" far too easily).
     *
     * ⚠️ The two numbers in the result line come from the server (how many rows really
     *    changed) — pending drafts and hidden entries lose the tag too, and they are
     *    not in the tag cloud ⇒ those numbers can be larger than what the user sees.
     *
     * ★★ `tagDeleteFileManaged` (2026-09-17 review): the database is not the content
     *    file's equal. `deploy/deploy.sh` runs `import.js --apply --file
     *    content/resources.json` on every deploy, and the importer upserts each entry
     *    with the file's `tags` ⇒ a tag still written in that file comes back at the
     *    next deploy, and nothing used to say so. This sentence appears **only when the
     *    server reports `fileManaged > 0`** (changed rows that are published and
     *    `source='import'`): the importer never touches user submissions, so for those
     *    the claim would be false and the line is not shown at all. The removal recipe
     *    lives in `docs/pending.md §5.96`.
     */
    tagDeleteAction: 'Delete the tag "{{tag}}"',
    tagDeleteConfirm:
      'Delete the tag "{{tag}}"? It affects {{count}} resources; the resources themselves stay.',
    tagDeleteConfirmAction: 'Delete it',
    tagDeleteWorking: 'Deleting…',
    tagDeleteDone:
      'Tag "{{tag}}" deleted: removed from {{resources}} resources and {{revisions}} pending revisions.',
    tagDeleteFileManaged:
      'Note that {{count}} of them come from the content file content/resources.json — deleting here will not survive the next deploy; remove the tag from content/resources.json as well.',
    tagDeleteFailed: 'Could not delete the tag.',
    loading: 'Loading…',
    loadFailed: 'Failed to load',
    retry: 'Retry',
    notFound: 'Entry not found',
    notFoundHint: 'It may have been removed, or the link is wrong.',
    page: 'Page {{page}} of {{total}}',
    prevPage: 'Previous',
    nextPage: 'Next',
    allTags: 'All tags',
    infoTitle: 'Details',
    infoSite: 'Website',
    infoKind: 'Type',
    infoLang: 'Language',
    infoTags: 'Category tags',
    infoAdded: 'Added',
    infoUpdated: 'Last updated',
    infoId: 'Entry ID',
    infoImage: 'Icon source',
    imageFromSite: 'Site favicon',
    imageCustom: 'Custom image',
    imageGenerated: 'Generated',
    related: 'More with this tag',
    openSite: 'Visit site',
  },
  /*
   * Contributor list for the resource library (2026-09-14, user request).
   *
   * "Record contributors in the backend (they are **not shown in the resource
   *  library itself**); a contributor may edit or take down the resources they
   *  own **without review** (**without deleting**); **managers can see the
   *  contributors in the library** and add or remove them per resource; a
   *  resource may have no contributors."
   *
   * ⚠️ These strings only ever appear in the admin-facing panel. The public list
   *    and detail pages must not use any of them; a render check watches that
   *    boundary.
   * ⚠️ Two things the wording has to keep straight, or it points people at the
   *    wrong action: skipping review is a per-resource thing (a contributor is
   *    NOT a site-wide editor), and the destructive-looking one is reversible
   *    (hide), unlike delete.
   */
  resourceContrib: {
    title: 'Contributors',
    hint: 'These people may edit or take this entry down without review.',
    empty: 'No contributors yet — only editors can change this one right now.',
    add: 'Add a contributor',
    remove: 'Remove',
    none: 'Nobody left to add.',
    save: 'Save the list',
    saving: 'Saving…',
    saved: 'List saved',
    failed: 'Could not save it. Try again.',
    searchPlaceholder: 'Find someone by name or email',
    noPublic: 'This list never appears on the public pages.',
    /** "Added by X" — `{{name}}` may be the unknown-account fallback below. */
    removedBy: 'Added by {{name}}',
    /** ⚠️ An account with no display name must fall back to this, never to blank. */
    unknownUser: 'Unknown account',
    max: '{{max}} people at most',
    directEdit:
      'You are a contributor here: your changes take effect **immediately**, without review.',
    hide: 'Take it down',
    restore: 'Put it back up',
    hideHint:
      'Taken down, it disappears from the public pages — the content and its revision history stay, and it can come back at any time.',
  },
  auth: {
    // Sign in
    loginTitle: 'Sign in',
    loginSubtitle: 'Signing in lets you submit content. Browsing the whole site works without it.',
    loggingIn: 'Signing in…',
    loginAction: 'Sign in',
    forgotPassword: 'Forgot your password?',
    noAccount: 'No account yet?',
    // Sign up
    registerTitle: 'Create account',
    registerSubtitle:
      'After signing up, open the confirmation email and click the link — your account is complete only then.',
    registering: 'Creating…',
    registerAction: 'Create account',
    hasAccount: 'Already have an account?',
    displayName: 'Display name',
    displayNamePlaceholder: 'The name others will see',
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    passwordPlaceholder: 'At least 8 characters',
    newPassword: 'New password',
    // Registration result (deliberately does not reveal whether the email exists)
    registerDone:
      'If that email is not registered yet, we have sent a confirmation email — your account is complete once you click the link in it.',
    registerDoneHint:
      'If it is already registered, just sign in; if the email never arrives, resetting your password also confirms the address.',
    // Email confirmation
    verifyTitle: 'Confirm your email',
    verifyWorking: 'Confirming…',
    verifyOk: 'Email confirmed',
    verifyOkHint: 'You can sign in now.',
    verifyFailed: 'This link is invalid or has expired',
    verifyFailedHint:
      'Confirmation links are valid for 24 hours and can only be used once. To get a new one, open the sign-in page and enter your email — the resend link there works without signing in.',
    verifyResend: 'Send a new confirmation email',
    verifyResending: 'Sending…',
    verifyResent: 'Sent. The link in the earlier email no longer works.',
    verifyNeeded: 'You can only sign in once your email is confirmed.',
    verifyNoToken: 'This link is incomplete — the confirmation parameter is missing.',
    /**
     * The self-service panel shown on the sign-in page when the email is unconfirmed.
     *
     * ⚠️ This panel is required, not decorative: an unconfirmed account cannot sign
     *    in, so the "resend" button on the account page (which needs a session) does
     *    not exist for these users. Without this entry point their only way out is a
     *    password reset — which requires receiving the very same email.
     */
    verifyBlockTitle: 'This email is not confirmed yet',
    verifyBlockHint:
      'Your account is complete only once you confirm it. Open the confirmation email we sent — if you cannot find it, send a new one below.',
    verifyBlockResend: 'Send a new confirmation email',
    verifyBlockSent:
      'If that email is registered and still unconfirmed, we have sent a new message.',
    verifyBlockNeedEmail: 'Enter your email address above first.',
    // Password reset
    resetRequestTitle: 'Reset your password',
    resetRequestSubtitle: 'Enter the email you registered with and we will send a reset link.',
    resetRequestAction: 'Send reset link',
    resetRequesting: 'Sending…',
    resetRequestDone: 'If that email belongs to an account, we have sent a password reset message.',
    resetRequestDoneHint:
      'The link is valid for 1 hour. If it has not arrived, check your spam folder.',
    resetTitle: 'Choose a new password',
    resetSubtitle: 'Once you do, you will be signed out on every other device.',
    resetAction: 'Set new password',
    resetWorking: 'Setting…',
    resetOk: 'Password updated',
    resetOkHint: 'Sign in with your new password.',
    // Account page
    accountTitle: 'Your account',
    accountEmail: 'Email',
    accountVerified: 'Email confirmed',
    accountUnverified: 'Email not confirmed',
    accountRole: 'Role',
    accountJoined: 'Joined',
    /*
     * ★ "Change your display name" -- the entry point and the feedback that live in
     *   the display-name row of the account page.
     *
     * ⚠️ Only **three** new keys; everything else reuses existing ones, so the same
     *    word is never maintained in two places:
     *      · block title / input label -> `auth.displayName`
     *      · input placeholder         -> `auth.displayNamePlaceholder`
     *      · "Save" / "Cancel"         -> `common.save` / `common.cancel`
     *      · too short / too long      -> `auth.err.nameMin` / `auth.err.nameMax`
     *        (both already live in `fieldIssueText`; on screen they are picked by the
     *        local check in `DisplayNameField.displayNameError` -- ⚠️ NOT by the server
     *        400 path: server `issues[]` carry no Zod code, so that path falls back to
     *        `auth.err.invalid`. That state of affairs is pinned by
     *        `apps/web/scripts/accountrender.tsx`).
     */
    nameEditAction: 'Change',
    nameSaved: 'Display name updated',
    namePublicNote:
      'Your display name is public: it is the name on the resources you add, in the contributor panel and in review records.',
    roleUser: 'Member',
    roleReviewer: 'Reviewer',
    roleEditor: 'Content editor',
    roleOwner: 'Owner',
    roleAdmin: 'Admin',
    roleGuideTitle: 'What each role can do',
    roleGuideIntro:
      'Every level below is **read straight from the permission matrix**, so this table cannot disagree with the actual behaviour.',
    roleGuest: 'Guest (not signed in)',
    guestCan1:
      'Browse the library, search, filter, open detail pages — nothing on the site requires signing in',
    guestCan2: 'Cannot submit, edit or review (signing in is for participating, not for reading)',
    rankNoteOwner:
      "The top level. **One capability beyond an admin**: only an owner can delete an entry for good without taking it down first; the rest of what is extra is **rank**: only an owner can set or unset admins, and an owner's own role cannot be changed from the web at all — that takes admin.js on the server.",
    rankNoteAdmin:
      'Manages accounts and roles: can promote a member to reviewer or content editor. But **admins are peers** — cannot change another admin, cannot demote themselves, and cannot promote anyone to admin.',
    rankNoteEditor:
      "The site's content owner: can approve their own submissions, and decides how content is presented (featured, taken down).",
    rankNoteReviewer:
      "Pipeline review: can approve or reject other people's submissions, but **cannot approve their own** — another reviewer has to do that (they can reject their own, which works as a withdrawal).",
    rankNoteUser:
      'Community member. Can submit content, edit what they submitted, and suggest edits to any published entry (those go through review too).',
    // ⚠️ The 7th key found by t10's static guard on 2026-09-13: `RoleGuide.tsx:115` used it, it never existed.
    rankNoteGuest:
      'You are not signed in. Once you sign in you can submit content, edit your own submissions, and suggest edits to any published entry.',
    canSubmitYes: 'You can submit content',
    canSubmitNo: 'Confirm your email before submitting content',
    capTitle: 'What you can do',
    capTypeResource: 'Resources',
    capTypeCalendar: 'Calendar',
    capTypeVideo: 'Videos',
    capTypeLive: 'Live list',
    capTypeSeed: 'Ranked seeds',
    capTypeUser: 'Account management',
    capTypeAudit: 'Audit log',
    // ⚠️ `content.*`'s "type" half is not a content type: it is a cross-cutting
    //    policy over resources / videos / events (② direct edit, owner hard delete).
    capTypeContent: 'Content',
    /*
     * ★ The type half of `share.moderate`.
     * ⚠️ Missing it does not throw: `capabilities.ts` falls back to printing the
     *    type name itself, so the account page would show the English word
     *    `share` next to a column of translated labels. `check:roleguide` now
     *    asserts every CAPABILITIES entry has both keys.
     */
    capTypeShare: 'Sharing',
    capActionSubmit: 'Submit',
    capActionEditOwn: 'Edit your own',
    capActionEditAny: 'Edit published entries',
    capActionEditUnpublished: 'Edit unpublished entries',
    capActionFeature: 'Set featured / official',
    capActionModerateContent: 'Take content down or restore it',
    /*
     * ★ The action half of `share.moderate` — the **third** moderate label here.
     * ⚠️⚠️ Without the `CAP_OVERRIDES` row in `capabilities.ts` this capability
     *    silently inherits `capActionModerate` ("Manage roles"), i.e. the UI
     *    shows a permission the person does not have. It looks like a wording
     *    bug, which is exactly why nothing was catching it.
     * ⚠️ Deliberately different from `capActionModerateContent`: a share can only
     *    be taken down by someone else, never put back (spec ruling 11).
     */
    capActionModerateShare: "Take down someone else's share",
    capActionReview: 'Review',
    // ⚠️ user.moderate (account governance). Shares the action name with
    //    resource.moderate (content curation) — CAP_OVERRIDES in
    //    capabilities.ts tells them apart by full capability name.
    capActionModerate: 'Manage roles',
    capActionRead: 'View',
    capActionManage: 'Maintain',
    capActionAuthor: 'Edit content directly',
    /**
     * ★ Full description per capability (used by the role guide), as opposed to
     * the short `capAction*` labels above.
     *
     * Keyed by the **full capability name** (`resource.submit`) rather than the
     * action name (`submit`): the same action reads differently per type —
     * `calendar.submit` is "submit events", `seed.submit` is "share world seeds"
     * — and sharing one key would make one of them wrong.
     *
     * ⚠️ These used to be hard-coded (Chinese-only) in `RoleGuide.tsx`'s
     * `CAP_TEXT`, so the English UI showed Chinese. Moved here 2026-09-13.
     * ⚠️ Three of them contain `**…**` emphasis (editAny / editUnpublished /
     * moderate) — the component **must** run them through `em()`.
     */
    capDescResourceSubmit: 'Submit a new resource entry (websites or tools are welcome)',
    capDescResourceEditOwn: 'Edit entries you submitted yourself',
    capDescResourceEditAny:
      'Edit any **published** entry (wiki-style — edits still go through review)',
    capDescResourceEditUnpublished: "Edit someone else's **unpublished** draft",
    capDescResourceFeature: 'Mark or unmark an entry as featured / official',
    capDescResourceModerate: 'Take published content **down**, and restore it',
    capDescResourceReview: 'Review resource submissions (approve / reject)',
    capDescCalendarSubmit: 'Submit events and activities',
    capDescCalendarReview: 'Review calendar content',
    capDescVideoSubmit: 'Submit video links',
    capDescSeedSubmit: 'Share world seeds',
    capDescSeedReview: 'Review ranked seed submissions',
    capDescUserModerate: 'Manage accounts and roles',
    capDescAuditRead: 'Read the audit log',
    /*
     * ★ The full description for `share.moderate` (the role guide renders it).
     * ⚠️ The `**anyone**` pair is real emphasis: the render site is
     *    `em(t(CAP_DESC[cap]))` in `RoleGuide.tsx`, and this key is registered in
     *    `DYNAMIC_KEYS` of `services/api/src/i18n-keys.test.ts` because it has no
     *    literal `t('…')` call site.
     * ⚠️ It states both halves on purpose: taking a share down is one-way, so an
     *    admin who expects to restore someone else's share would hit a 403.
     */
    capDescShareModerate:
      'Take down **anyone**’s share that is on the board (but not put someone else’s back).',
    logoutAction: 'Sign out',
    loggingOut: 'Signing out…',
    // Errors
    invalidCredentials: 'That email and password do not match',
    emailNotVerified:
      'This email is not confirmed yet — your account is complete only once you confirm it.',
    videoExists: 'That video is already on the site — try another, or look for it on the wall.',
    /*
     * ⚠️ "already recorded" and "already on the wall" are different things:
     * the former is a duplicate in an **editor-maintained list**, the latter is
     * a user-posted video. Telling an editor to "look for it on the wall" would
     * send them looking for something that is not there.
     */
    liveExists: 'That channel is already in the live list — one entry per channel per platform.',
    // Ranked Seeds (upstream covers only ~80%, so "not found" is normal, not an error)
    seedNotFound:
      'That match ID is not in the seed database — upstream only covers about 80% of historical matches, so this is likely one of the missing ones.',
    seedExists: 'That match ID has already been recorded — no need to add it again.',
    seedServiceUnavailable:
      'The seed service is temporarily unavailable. Please try again shortly.',
    seedWriteDisabled:
      'Seed submission is temporarily switched off — that is on our side, not yours. Please try again later.',
    /*
     * ⚠️ Must not be merged with the two above (added 2026-09-19, before open-sourcing).
     * "This instance has no upstream configured" is now the **default** state, and it
     * is not a transient failure: retrying changes nothing, and what the reader needs
     * to know is that their deployment is missing a setting.
     */
    seedNotConfigured:
      'This instance has no seed data source configured — this is not a temporary fault, and retrying will not change it.',
    rateLimited: 'Too many attempts. Try again in {{seconds}} seconds.',
    accountSuspended: 'This account has been suspended.',
    sendFailed: 'The message could not be sent. Please try again later.',
    invalidToken: 'This link is invalid or has expired.',
    genericError: 'Something went wrong. Please try again.',
    err: {
      emailFormat: 'That does not look like an email address',
      passwordMin: 'Password must be at least {{min}} characters',
      passwordMax: 'Password cannot be longer than {{max}} characters',
      nameMin: 'Display name must be at least {{min}} characters',
      nameMax: 'Display name cannot be longer than {{max}} characters',
      required: 'This field is required',
      tooLong: 'This is too long',
      invalid: 'This value is not valid',
    },
  },
  download: {
    title: 'Desktop app',
    desc: 'The resource library, calendar and ranked seeds in one window you can leave open. Windows 10 / 11, 64-bit.',
    action: 'Download',
    smartScreenSummary: 'Windows says "Unknown publisher" — what now?',
    smartScreenBody:
      'That is expected: we have not bought a code signing certificate. Click "More info", then "Run anyway". The same prompt appears for every new version.',
  },
  update: {
    checking: 'Checking for updates…',
    available: 'Version {{version}} is available',
    download: 'Download',
    downloading: 'Downloading {{version}}… {{percent}}%',
    downloadingNoPercent: 'Downloading {{version}}…',
    ready: 'Version {{version}} is ready',
    restart: 'Restart and install',
    none: 'You are up to date',
    error: 'Update failed: {{message}}',
    retry: 'Retry',
    dismiss: 'Dismiss',
  },
  /**
   * Submitting content (the M2 UGC entry point).
   *
   * The rule throughout: **never let someone fill in a form before telling them
   * they cannot submit.** Logged out, unverified email, missing permission — all
   * of those are stated before the form appears, and every "no" comes with the
   * next step (sign in / verify / go look at the existing entry).
   * The form is long (a body can be thousands of words); being stopped after
   * writing all of it is the worst possible experience.
   */
  submit: {
    tagAdd: 'Add',
    tagRemove: 'Click to remove this tag',
    tagExistingHint: 'Tags already in use (reusing them is better — it keeps filtering useful):',
    imageUpload: 'Upload a file',
    imageUploading: 'Uploading…',
    imageClear: 'Remove image',
    errImageTooLarge: 'The image is larger than {{mb}} MB. Please compress it first.',
    errImageType: 'That is not a supported image format. PNG / JPG / WebP / GIF only.',
    errImageFailed: 'Upload failed. Please try again.',
    note: 'A note for the reviewer (optional)',
    notePlaceholder:
      'e.g. this is a community correction, or the issue from the last rejection is fixed.',
    pageTitle: 'Submit a resource',
    subtitle:
      'Recommend an MCSR-related site or tool. Submissions are reviewed before they appear in the library.',
    flowNote:
      'Submitting does not publish immediately: the entry goes into the review queue and only appears in the library after a reviewer approves it. The outcome shows up under "Me".',

    title: 'Title',
    titlePlaceholder: 'e.g. MCSR Ranked Leaderboard',
    hintTitle: 'Write it in the entry\u2019s main language. Up to 120 characters.',
    titleEn: 'English title',
    titleEnPlaceholder: 'Optional, e.g. MCSR Ranked Leaderboard',
    hintTitleEn:
      'A title in the other language so both audiences can find it. The content itself is not translated.',

    url: 'URL',
    urlPlaceholder: 'https://example.com',
    hintUrl: 'Must be a full http:// or https:// address.',

    imageUrl: 'Image',
    imagePlaceholder: 'Leave empty to use the site icon automatically',
    hintImage:
      'Upload a file (up to {{mb}} MB) or paste a URL. Leave it empty to use the site icon.',

    summary: 'One-line summary',
    summaryPlaceholder: 'Leave empty to derive it from the body',
    hintSummary: 'The sentence shown on list pages.',

    body: 'Body',
    bodyPlaceholder:
      'Markdown is supported. Explain what this is, how to use it, and what to watch out for.',
    writeTab: 'Write',
    previewTab: 'Preview',
    previewEmpty: 'Nothing yet.',

    tags: 'Tags',
    tagsPlaceholder: 'e.g. ranked, leaderboard, 1.16.1',
    hintTags:
      'Separated by commas or spaces, up to 12. Version numbers (like 1.16.1) are common tags too.',

    kind: 'Type',
    hintKind: 'Website = use it in the browser; Tool = something you download or install.',
    lang: 'Language',
    hintLang: 'The language of the entry\u2019s main content.',

    action: 'Submit for review',
    submitting: 'Submitting…',
    reviewNote: 'Goes into the review queue and goes live once approved.',

    needLogin: 'Submitting requires signing in. Browsing does not — only submitting does.',
    needVerify:
      'You need to verify your email before submitting. It is the only thing gating submissions: every entry should have a person behind it who can receive a reply.',
    gotoVerify: 'Verify your email',

    doneTitle: 'Submitted',
    doneSub: 'The entry is now in the review queue. The outcome will show up under "Me".',
    doneRevision:
      'This is revision {{revision}}. A reviewer will see it, and it goes live once approved.',
    submitAnother: 'Submit another',
    viewMine: 'View my submissions',

    errDuplicate: 'This URL has already been listed.',
    openExisting: 'Open the existing entry',
    /**
     * The action label paired with `openExisting`.
     *
     * 📌 It was found one round later than the batch above, and the reason is worth
     *    recording: it is referenced as **data** (`submissionErrors.ts:76` sets
     *    `action.labelKey = 'submit.goEditMine'`), **not** as a direct `t('…')`
     *    argument — so t10's "scan `t('literal')`" guard **cannot see it**.
     *    The consequence is identical: the button renders the raw key
     *    `submit.goEditMine`. This is a **known gap in that guard** (see the note in
     *    `services/api/src/i18n-keys.test.ts`); catching it needs a check over
     *    `labelKey` literals, not that scan.
     */
    goEditMine: 'Edit my entry',
    errAlreadyPending:
      'This entry already has an edit waiting for review. Wait for the outcome before editing again.',
    errNotAuthor: 'This entry was not submitted by you, so you cannot edit it.',
    errNeedVerify: 'Your email is not verified yet — verify it and you can submit.',
    errForbidden: 'This account is not allowed to submit content.',
    /*
     * ⚠️ The six keys below were found on 2026-09-13 by **t10's static literal-key guard**:
     *    they are referenced by live code but never existed
     *    (`submissionErrors.ts:73/:83/:88/:173/:182`, `ResourceForm.tsx:567`).
     *    `t()` returns an unknown key **as-is**, so on a failed submit the user saw
     *    strings like `submit.errUrlExistsMine` — the worst possible place.
     *    📌 Attribution: **pre-existing gap**, not something this round introduced.
     */
    errUrlExistsMine:
      'You already submitted this URL, but it is not live yet (still pending, or it was rejected). Fix that one instead of submitting again.',
    errUrlExistsLive: 'This URL is already live. Open that entry instead of submitting it again.',
    errUrlExistsOther:
      'Someone else already submitted this URL, and it is not live yet. Check back once it is published.',
    errSessionExpired:
      'Your session has expired (or you are not signed in). Sign in again to continue.',
    errCrossOrigin:
      'The request was rejected by the security policy: the front end and the API do not share an origin. In local development this is almost always a misconfigured proxy.',
    hintNote:
      '{{used}} / {{max}} characters. Only reviewers see this — it never appears on the resource page.',
  },
  /**
   * Review (**generic** — the M4 calendar / videos / seeds reuse this exact UI).
   *
   * Two things get extra care here, because they are the easiest to get wrong:
   *   · Reject vs approve must state what happened to the live site (when an
   *     edit to a published entry is rejected the old content stays live —
   *     without saying so, reviewers think they just removed the entry).
   *   · 401 and 403 must read completely differently (sign in / you really do
   *     not have permission). Collapsing both into "something went wrong"
   *     makes a properly authorised person think they got logged out.
   */
  review: {
    mineBadge: 'yours',
    selfReviewBlocked:
      'You submitted this, so **another reviewer** has to approve it. You can still reject it (that works as a withdrawal).',
    noteFromSubmitter: 'Note from the submitter',
    queueTitle: 'Review queue',
    queueCount: '{{count}} awaiting review',
    queueEmpty: 'Nothing awaiting review',
    tabAll: 'All',
    nothingPending: 'The queue is empty',
    nothingPendingHint: 'Nothing to review — new submissions will show up here.',
    refresh: 'Refresh',

    isEdit: 'Edit',
    isNew: 'New',
    unknownAuthor: 'Unknown author',
    unknownTypeWarning:
      'The queue contains a type this build does not support. Refresh the page; if it persists, the frontend is older than the server.',

    detailTitle: 'Review',
    unknownType: 'No such content type (or the address is mistyped).',
    prevRejections: 'This author has had {{count}} rejection(s) before. For context only.',
    editExplain:
      'This is an edit to a published entry — the live content has **not changed at all** and is only replaced once approved.',
    changed: 'changed',
    showOldBody: 'Show the live version\u2019s body',

    decide: 'Decision',
    approve: 'Approve and publish',
    approving: 'Approving…',
    reject: 'Reject',
    rejecting: 'Rejecting…',
    rejectReason: 'Reason for rejection (required)',
    rejectPlaceholder: 'State what needs to change — the author sees this text verbatim.',
    rejectHint:
      '{{used}} / {{max}} characters. A rejection with no reason leaves the author guessing, and they will resubmit it unchanged.',

    approvedNotice: 'Approved r{{revision}} — the content is live.',
    rejectedNotice: 'Rejected r{{revision}}.',
    liveKept: 'This entry was already published, so the live version stays as it is.',
    alreadyHandled:
      'Another reviewer just handled this entry — that is normal for concurrent review, not an error.',
    actionFailed: 'The action failed. Please try again.',

    needLogin: 'Reviewing requires signing in.',
    forbidden: 'You do not have permission to review this type of content.',
    forbiddenHint:
      '{{name}}, your account has no review permission right now. Ask an administrator to adjust your role if you need it.',
    forbiddenHintAnon: 'This page requires review permission.',
    gone: 'This entry has nothing pending any more — it may have just been handled.',
    backToQueue: 'Back to the queue',
    openItem: 'Open the entry',
    loadFailed: 'Failed to load. Please try again later.',
  },
  /**
   * "My submissions".
   *
   * This is where the review pipeline closes its loop: the rejection reason a
   * reviewer is forced to write has exactly one reader — the author. Without
   * this page that reason goes into the database and is never read again.
   */
  mine: {
    edit: 'Edit',
    resubmit: 'Edit and resubmit',
    pendingHint:
      'Another edit is already waiting for review. You can edit again once that one is settled.',
    reviewedAt: 'reviewed {{date}}',
    title: 'My submissions',
    subtitle: 'What you have submitted, and where each one stands.',
    empty: 'Nothing submitted yet',
    emptyHint: 'If you know a website or tool worth listing, you can recommend it here.',
    loadFailed: 'Failed to load. Please try again later.',
    submitNew: 'Submit something',
    liveRevision: 'live r{{revision}}',
    pendingRevision: 'pending r{{revision}}',
    openItem: 'Open the entry',
    rejectReasonTitle: 'Why it was rejected',
  },
  /**
   * Editing an existing entry (M2, round two).
   *
   * Two ways in, and the wording has to cover both:
   *   · "Suggest an edit" on an entry page — wiki-style, on someone else's entry
   *   · "Edit and resubmit" in My submissions — on your own rejected entry
   */
  edit: {
    title: 'Edit entry',
    subtitle:
      'Your edit goes back into the review queue — the live page keeps showing this version until it is approved.',
    suggestAction: 'Suggest an edit',
    liveUnchanged:
      'Submitting this edit does **not** change the page immediately: it goes into the review queue, and only replaces the live version once approved.',
    /** Submit button at the bottom of the form */
    action: 'Submit edit',
    /** Entry button on the detail page (editors and admins see this wording) */
    modifyAction: 'Edit',
    editorHint: 'Once you submit, you can approve this revision yourself from the review queue.',
    busyNotice:
      'An edit (r{{revision}}) is already waiting for review — only one pending edit per entry is allowed, so you cannot submit another one right now. Wait for that one to settle, or open the review queue to see what it changes.',
    busyGoReview: 'Open it in the review queue',
    submitting: 'Submitting…',
    doneTitle: 'Edit submitted',
    doneSub:
      'This revision is now in the review queue. The page changes only after it is approved.',
    notFound:
      'No such entry, or it is not yours (unpublished entries are only visible to their author).',
    loadFailed: 'Failed to load. Please try again later.',
  },
  /**
   * Content curation: featured / official / take down.
   *
   * These are **editorial** decisions, not review decisions: review answers
   * "may this revision go live", curation answers "should what is already
   * live keep being presented this way". Taking something down is not the
   * same as rejecting a revision — it targets the live entry, not a version.
   */
  moderate: {
    title: 'Curation',
    hide: 'Take down',
    restore: 'Put back up',
    failed: 'The action failed. Please try again.',
    hiddenNote:
      'This entry is **taken down** and no longer shown in the library. To put it back, use "Put back up" on this page.',
    showHidden: 'Show taken-down entries',
    hiddenBadge: 'taken down',
  },
  /**
   * Account management (admin only).
   *
   * One rule runs through the wording: **every disabled control says why**.
   * "You cannot change another admin" is a policy decision, not a broken UI —
   * someone staring at a greyed-out select must be able to read that sentence.
   */
  admin: {
    title: 'Accounts',
    subtitle:
      '{{count}} accounts. Changing a role requires a reason, and the reason goes into the audit log.',
    colAccount: 'Account',
    colVerified: 'Email verified',
    colCreated: 'Registered',
    colRole: 'Role',
    selfBadge: 'you',
    yes: 'Yes',
    no: 'No',
    save: 'Save',
    saving: 'Saving…',
    roleChanged: 'Changed to "{{role}}"',
    reasonPlaceholder: 'Reason for the change (required)',
    peerLocked: "Another admin's role cannot be changed — admins are peers.",
    lockedOwner: 'Anything involving an owner can only be changed on the server (admin.js role).',
    lockedSelf: 'You cannot demote yourself — that would lock you out of this page.',
    lockedPromote: 'You cannot promote someone to admin.',
    lockedPeer: "Another admin's role cannot be changed — admins are peers.",
    lockedGeneric: 'This role cannot be changed here.',
    lastAdminNote:
      'If you are the last admin and try to demote yourself it will be refused: nobody would be able to change roles any more. Use the admin.js role command on the server if you really need that.',
    forbidden: 'You do not have permission to manage accounts.',
    loadFailed: 'Failed to load. Please try again later.',
    errPeer: "You cannot change another admin's role.",
    errLastAdmin:
      'The last admin cannot be demoted — nobody would be able to change roles any more.',
    errReason: 'A reason is required.',
    errFailed: 'The action failed. Please try again.',
  },
  /**
   * Personal marks: favorite / note / rating.
   *
   * ⚠️ The wording has to make clear the **note is private** — otherwise people
   * assume it is a public review, and either do not write one or write it as if
   * it were public. Both are wrong.
   */
  marks: {
    favorite: 'Favourite',
    favorited: 'Favourited',
    myRating: 'My rating',
    rateN: 'Rate {{n}}',
    clearRating: 'Clear rating',
    noRating: 'No ratings yet',
    ratingCount: '{{count}} rating(s)',
    ratingTitle: 'Average {{avg}} from {{count}} rating(s)',
    note: 'My note (only you can see this)',
    notePlaceholder: 'e.g. what to watch out for on 1.16.1, or why I kept this.',
    noteHint:
      '{{used}} characters. This text does **not** appear on the entry page and nobody else can read it.',
    noteLabel: 'My note',
    saveNote: 'Save note',
    noteSaved: 'Note saved',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Could not save. Please try again.',
    needLogin: 'Sign in to favourite entries, rate them, and keep a note only you can see.',
    favoritesTitle: 'My favourites',
    favoritesSubtitle: 'The entries you kept, with the notes and ratings you gave them.',
    noFavorites: 'Nothing favourited yet',
    noFavoritesHint:
      'Use "Favourite" on an entry page — then you can come back here, and jot down why you kept it.',
    gone: 'This entry is not on the site right now',
    loadFailed: 'Failed to load. Please try again later.',

    /*
     * ⑤ 收藏数。
     *
     * ⚠️ 措辞说明（与 spec 的 `saved` 一致，刻意与上面的 `Favourite` 不同）：
     *    这一节里表示**动作**的词是 `Favourite` / `Favourited`，
     *    而这两条表示的是**总数**。两条各有理由：
     *      · 只在这里用 `Favourite` 会得到 "3 favourited" —— 读起来像一个动词短语，
     *        而它要表达的是一个数字（有多少人收藏了它）；
     *      · `saved` 是资源库语境里通用的说法，且不牵扯英式/美式拼写
     *        （`Favourite` 是英式，`Favorite` 是美式 —— 这句文案不该成为
     *         决定全站拼写风格的那一处）。
     *    ⚠️ 这是一次**有意识的用词不统一**，不是漏改；若将来全站统一拼写风格，
     *    这两条应当一起纳入考虑，而不是单独改成 `favourited`。
     *
     * ⚠️ 插值必须写**双**花括号 `{{count}}`：i18next 对单花括号的 `{count}`
     *    **不替换、原样显示**（实测 `t('... {count}', { count: 3 })` → `"… {count}"`）。
     *    第一版这里漏写成单花括号，英文界面上会直接显示成字面的 `{count} saved` ——
     *    与 zh-CN 那份（`收藏 {{count}}`）不一致，而**对齐测试查不出这个**
     *    （它比的是键，不是值的内容）。
     */
    favoriteCount: '{{count}} saved',
    noFavoriteYet: 'No saves yet',
  },
  /**
   * Calendar (M4).
   *
   * Three constraints run through every string in this section:
   *
   *   1. **A time never appears without its time zone** (Q2: store the local wall
   *      clock plus the IANA zone, convert for display). A bare `20:00` carries no
   *      information — 20:00 where? With the zone attached, people outside it can
   *      still work out when it happens.
   *
   *   2. **"Ended" is derived, not a status** (see `isEventPast` in
   *      shared/calendar.ts). The wording must not read as though someone set it.
   *
   *   3. **Past events still enter the review queue** (Q4c). See
   *      `pastBadge` / `pastExplain`: the reviewer has to be told this is not a
   *      mistake in the form.
   */
  calendar: {
    // ---- Enums. The UI never shows RANKED_MILESTONE / QUARTERFINAL raw ----
    tag: {
      TOURNAMENT: 'Tournament',
      COMMUNITY: 'Community event',
      RANKED_MILESTONE: 'Ranked milestone',
    },
    /*
     * ⚠️★ The `stage` group (Qualifier / Main round / Quarter-final /
     *    Semi-final / Third-place match / Final) used to live here. It was
     *    **removed on 2026-09-13** with requirement ⑥.
     *
     * Not because nothing used it — because the dimension itself was
     * meaningless: it is a flat label with no hierarchy ("semi-final of
     * what?"), and in practice you cannot fill it in for the events that
     * matter. The four rounds of one tournament are played on four different
     * days, while an event has one set of times, so at most one of the six
     * values ever applies and the editor has to guess which.
     *
     * ⚠️ The database column is still there (`calendar_events.stage`, same rule
     *    as every published migration), new writes leave it NULL, and the
     *    `stage` field on `CalendarEvent` survives only so pre-017 snapshots
     *    still render — the one screen that read it was removed in the same
     *    round.
     */
    /*
     * Professionalism level / participation scope / entry requirement (the two
     * dimensions added by migration 011, plus the requirement added on
     * 2026-09-13), and the detail lists behind "scope" (continents / countries).
     *
     * ⚠️ The only difference from the `tag` group above: these go
     *    through i18n from day one rather than being hard-coded in a shared map.
     *    That one is legacy (see the note at the end of shared/calendar.ts) —
     *    do not copy it.
     *
     * ⚠️ All of them are **nullable** (a ranked milestone has no meaningful
     *    level), so every group needs an explicit "any" option: otherwise "not
     *    filled in" and "not filtering" look identical while meaning opposite
     *    things.
     *
     * ⚠️ **`level` was narrowed from four values to two on 2026-09-13** (user
     *    request): `SEMI_PRO` and `CASUAL` were folded into `AMATEUR`.
     *    Two of the four could not be told apart from "amateur" when data was
     *    actually being entered — the person filling the form was guessing, so
     *    the same event kept moving between the two and nothing ever errored:
     *    only the filtered results disagreed. The two-value line ("does this put
     *    food on the table") can be judged at a glance; four could not.
     *    📌 The value list now lives in `EVENT_LEVELS` (shared/constants.ts).
     */
    level: {
      PRO: 'Professional',
      AMATEUR: 'Amateur',
    },
    /**
     * ⚠️ **"Regional" (`REGION`) was removed on 2026-09-13** (user request).
     *
     *    The reason it was added was that MCSR communities organise by country
     *    and by region, but when data was actually entered "region" and
     *    "country" could not be told apart (is "Southeast Asia" a region or a
     *    country? what about "Greater China"?), and the result was the same
     *    event being moved back and forth between the two.
     *    📌 The value list now lives in `EVENT_SCOPES` (shared/constants.ts).
     */
    scope: {
      GLOBAL: 'Worldwide',
      CONTINENT: 'Continental',
      COUNTRY: 'National',
    },
    /**
     * Entry requirement (added 2026-09-13).
     *
     * ⚠️ "Requirement" here means **how you get in** (qualify / invited / anyone
     *    can enter), not how formal the event is — that is `level`. The
     *    distinction is not decoration: a qualifier can be an amateur event and
     *    an invitational can be professional. Folding them into one dimension
     *    forces whoever fills the form to pick between two correct answers, and
     *    whichever they pick, filtering loses the event.
     * ⚠️ Nullable for the same reason as the others: a ranked milestone has no
     *    entry requirement to speak of.
     */
    access: {
      QUALIFIER: 'Qualifier',
      INVITE: 'Invitational',
      OPEN: 'Open to all',
    },
    /**
     * The **detail** behind "scope": when `scope` is a continent, pick from the
     * group above; when it is a country, pick from the group below.
     *
     * ⚠️ Both are **multi-select** (the user's own example was "Asia & Oceania")
     *    and they match on **any** selected value, exactly like tags — writing
     *    it as "all of them" would make "Asia + Oceania" match nothing at all.
     * ⚠️ `country` is a **hand-written short list, not the ISO 3166 table**: the
     *    full table is ~250 entries and would turn a three-item control into a
     *    200-row scroll, while MCSR events keep coming back to these.
     *    📌 The list is `COUNTRIES` in shared/constants.ts — **adding a country
     *      means adding a key here too** (both languages). Miss it and the UI
     *      shows the bare code (`BR`), and that kind of "renders, but means
     *      nothing to the reader" mistake is much less obvious than a raw
     *      `t()` key.
     * ⚠️ Continents follow **how esports events actually split regions** (the
     *    Americas are separate, Antarctica does not play) rather than the seven
     *    continents of a geography textbook — do not "fix" it by adding a
     *    seventh.
     */
    continent: {
      ASIA: 'Asia',
      EUROPE: 'Europe',
      NORTH_AMERICA: 'North America',
      SOUTH_AMERICA: 'South America',
      OCEANIA: 'Oceania',
      AFRICA: 'Africa',
    },
    country: {
      CN: 'China',
      JP: 'Japan',
      KR: 'South Korea',
      SG: 'Singapore',
      PH: 'Philippines',
      ID: 'Indonesia',
      VN: 'Vietnam',
      TH: 'Thailand',
      IN: 'India',
      AU: 'Australia',
      NZ: 'New Zealand',
      US: 'United States',
      CA: 'Canada',
      MX: 'Mexico',
      BR: 'Brazil',
      AR: 'Argentina',
      CL: 'Chile',
      GB: 'United Kingdom',
      DE: 'Germany',
      FR: 'France',
      NL: 'Netherlands',
      SE: 'Sweden',
      PL: 'Poland',
      ES: 'Spain',
      IT: 'Italy',
      UA: 'Ukraine',
      RU: 'Russia',
      TR: 'Turkey',
    },
    /**
     * Series colour names (2026-09-13, item ⑤).
     *
     * When an owner picks a colour for a series these are the **tooltips /
     * aria-labels on the swatches** — they only have to answer "which one did I
     * pick", not to describe what the colour looks like.
     *
     * ⚠️ These are **names only; the colour values are not here**. The palette is
     *    a fixed twelve, and every value has to read as a thin line on **both**
     *    themes (dark `#131519` / light `#f7f8fa`). That contrast argument
     *    travels with the values, so they live in `SERIES_COLORS`
     *    (shared/constants.ts) — copying them here would turn "which copy is
     *    right" into a question with two drifting answers.
     * ⚠️ Colour is used in exactly **two** places: the date line on the calendar
     *    and the small dot beside a series in the list. **Not** as a card
     *    background — so the names do not need "light red / dark red" detail;
     *    one extra level only makes people guess once more.
     */
    seriesColor: {
      red: 'Red',
      orange: 'Orange',
      amber: 'Amber',
      green: 'Green',
      teal: 'Teal',
      cyan: 'Cyan',
      blue: 'Blue',
      indigo: 'Indigo',
      purple: 'Purple',
      pink: 'Pink',
      brown: 'Brown',
      slate: 'Slate',
    },
    /**
     * "No colour". What is stored is `null`, **not** white — white is only a
     * rendering convention (`SERIES_COLOR_NONE` in shared/constants.ts) and may
     * change with the theme, while `null` will not. So this string says "no
     * colour was picked", not "white was picked".
     */
    seriesColorNone: 'No colour',
    /**
     * Tooltip / aria-label of the little dot an owner clicks.
     *
     * ⚠️ Neither this nor `seriesColorNone` is a colour name, so neither is in
     *    the table above: those keys have to line up one-for-one with
     *    `SERIES_COLORS`, and two non-colour entries in there would make "is the
     *    palette complete" impossible to check mechanically.
     */
    seriesColorSet: 'Change colour',
    /*
     * Shown when the colour write fails.
     *
     * ⚠️ It has to say "nothing was saved, try again" rather than just "error":
     *    the swatch on screen does not roll back by itself, so without this the
     *    user believes the colour stuck.
     */
    seriesColorFailed: 'The colour was not saved. Try again.',
    /** The "no filter" option shared by all three single-choice dimensions. */
    filterAny: 'Any',

    yes: 'Yes',
    no: 'No',

    /*
     * ★ Q4c: past events stay in the review queue, so reviewers really will run
     * into events that have already finished.
     *
     * Together these two sentences have to say two things: this is normal (the
     * form was not filled in wrongly), and "the date is in the past" is not by
     * itself a reason to accept or reject — otherwise a reviewer would default to
     * rejecting every historical entry, and historical tournament entries are
     * exactly the kind that carry value.
     */
    pastBadge: 'Ended',
    pastExplain:
      'This event has already finished. It still enters the review queue, because being in the past is not by itself a reason to accept or reject it — historical tournament entries are just as valuable. Judge the content on its own merits.',

    /** Field labels used by the review detail view. */
    fields: {
      title: 'Title',
      titleEn: 'English title',
      startsAt: 'Starts (local time)',
      timezone: 'Time zone',
      endsAt: 'Ends (local time)',
      allDay: 'All day',
      /*
       * ⚠️ There used to be a `scheduleText` key here ("Specific times", the 015
       *    free-text box). It is **gone**: the field was removed from the model
       *    entirely and replaced by `slots` below — real **multiple** time slots,
       *    each with its own start and end, rather than a few unchecked lines.
       *    A free-text box looks like structured data while being neither
       *    positionable on the grid nor filterable.
       *    (An orphan key costs nothing, it just leaves the next reader thinking
       *    that branch is still there.)
       */
      slots: 'Match times',
      tags: 'Tags',
      level: 'Level',
      scope: 'Scope',
      access: 'Entry requirement',
      scopeDetail: 'Regions',
      location: 'Location',
      url: 'Link',
      lang: 'Language',
      description: 'Description',
    },

    // -------------------------------------------------------------------------
    // List page
    // -------------------------------------------------------------------------
    submitAction: 'Submit an event',
    listSubtitle:
      'Tournaments, community events and ranked season milestones. Times are stored in the zone the organiser published them in — so every entry carries its zone name.',
    filterTagsLabel: 'Which kinds to show',
    /*
     * ⚠️ `filterTagsHint` / `filterTagsLocked` were removed here.
     *
     * They served the "the last tag cannot be switched off" rule, whose only
     * reason was that the server cannot express "no tags selected" (an empty
     * array and no parameter are the same query) — so the UI could neither
     * really reach zero nor tell the truth about it.
     *
     * Client-side filtering removed that reason: selecting none now means
     * showing none, which is honest. The two keys became orphans.
     */
    showPast: 'Show finished',
    resultCount: '{{count}} event(s)',
    empty: 'No events match these filters',
    emptyHint: 'Turn on "Show finished", or switch back on the chips you just turned off.',
    loadFailed: 'Could not load. Please try again later.',
    backToList: 'Back to calendar',
    until: 'to {{time}}',
    allDayBadge: 'All day',
    /**
     * Slot count on a card (2026-09-13, alongside the multi-slot `fields.slots`).
     *
     * ⚠️ It answers "does this run over several days": if a card prints one start
     *    time only, an event played in three stretches looks exactly like a
     *    one-day event.
     * ⚠️ The number counts **slots**, not matches — three weekends is three
     *    slots while still being one event. That is why the wording says "times"
     *    and not "matches".
     * ⚠️ `{{count}}` is i18next interpolation (single braces render literally,
     *    see `marks.favoriteCount`).
     */
    slotsCount: '{{count}} times',
    /*
     * Separator between the slots on the event page's "Match times" line.
     *
     * ⚠️ It is a dictionary entry, not a hard-coded `', '`: the Chinese line
     *    needs a full-width comma to read as a list of parallel times. Hard-code
     *    one and the other language gets punctuation from the wrong script.
     */
    slotSeparator: ', ',
    yourTime: 'That is {{time}} your time ({{tz}})',

    // -------------------------------------------------------------------------
    // ICS subscription
    //
    // ⚠️ This block is one of the M4 acceptance criteria: "the subscribed ICS
    //    shows up in the phone's built-in calendar". Every sentence here answers
    //    "where exactly do I paste this link", not "here is a file to download".
    // -------------------------------------------------------------------------
    icsTitle: 'Subscribe to the calendar',
    icsWhy:
      'Subscribing keeps the calendar up to date on its own. A downloaded .ics is a one-off snapshot — whatever it looked like the moment you saved it is what it will always look like, and newly approved events never appear.',
    icsUrlLabel: 'Subscription address (copy it, then paste it into your phone calendar)',
    icsCopy: 'Copy link',
    icsCopied: 'Copied',
    icsCopiedHint: 'Copied. Now paste it into your calendar app under "Subscribe" or "Add by URL".',
    icsCopyManual:
      'Could not copy automatically. The link is selected — press Ctrl+C (or long-press on a phone) to copy it.',
    icsWebcal: 'Hand it to the system calendar',
    icsWebcalHint: 'Works on iOS / macOS. On other systems use the copy button above.',
    icsNoOrigin:
      'This environment has no site address, so there is no subscription link to paste. Open this page on the live site.',
    icsIosTitle: 'iPhone / iPad',
    icsIos:
      'Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste the link into "Server" → Save',
    icsAndroidTitle: 'Android',
    icsAndroid:
      'The built-in calendar has no subscription entry; use Google Calendar on the web: Other calendars → From URL → paste the link',
    icsDesktopTitle: 'Desktop',
    icsDesktop:
      'macOS Calendar: File → New Calendar Subscription. Outlook or Google Calendar on the web: Add calendar → Subscribe from web.',
    icsRefresh:
      'Calendar clients usually refresh every few hours to a day, so an event approved just now will not show up on the phone immediately.',
    icsPublishedOnly:
      'Only published events go into the subscription. Pending and rejected ones do not — they appear automatically once approved.',

    /**
     * ③ Top-of-page anchor shown after the subscribe block moved to the bottom.
     *
     * ⚠️ This link is part of the move, not an optional extra: "you can find the
     *    subscribe entry" was an acceptance criterion for the original layout.
     * ⚠️ It is **not** a second subscribe entry — copying the link and the
     *    step-by-step instructions still live in exactly one place, at the bottom.
     */
    icsJump: 'Subscribe ↓',

    // -------------------------------------------------------------------------
    // Event series (③)
    //
    // Series are a real entity (the `calendar_series` table): the form either
    // picks an existing series or creates a new one.
    //
    // ⚠️ Series are **public** (§9-5): listing and searching need no login, so
    //    there is deliberately no "log in to search" line here — that line makes
    //    anonymous visitors think they are locked out while they are not.
    // -------------------------------------------------------------------------
    seriesSectionTitle: 'Event series',
    seriesSectionHint: 'Editions of the same event are grouped when they share a series name.',
    seriesSearch: 'Search series',
    /**
     * ⚠️ A different message from `seriesEmpty`, deliberately: this one means
     *    "searched, nothing matched"; `seriesEmpty` means "there are no series yet".
     *    Merging them makes users think the data is gone instead of their query missing.
     */
    seriesNoMatch: 'No matching series',
    seriesEmpty: 'No event series yet',
    /*
     * A series is expanded but has no events under it.
     * ⚠️ A third message, not a reuse of either above: this one means "the series
     * exists, it just has nothing in it", `seriesEmpty` means "there are no series
     * at all", and `seriesNoMatch` means "searched, nothing matched".
     */
    seriesExpandedEmpty: 'No events in this series yet',
    /**
     * ⚠️ `{{count}}` is i18next's interpolation syntax (single braces render literally).
     *
     * ⚠️ The noun must be in the string. `'{{count}} upcoming'` read as a half sentence
     *    ("3 upcoming") and it also described something other than what the number means:
     *    the count is "published events of this series that have not ended yet"
     *    (`services/api/src/calendar/events.ts:970`, `COALESCE(ends_at_utc, starts_at_utc) >= now`)
     *    — an event that is running right now is counted too, and "upcoming" would be wrong
     *    for it. zh-CN (`'{{count}} 场未结束'`) has always said "not finished yet".
     *
     * ⚠️ Do **not** add plural-suffix keys (`seriesCount_one` / `_other`): this repo has no
     *    plural suffixes at all (F27), counted strings are single-key + `{{count}}`, and the
     *    `(s)` form is the established way here (see `marks.ratingCount`, `calendar.resultCount`).
     */
    seriesCount: '{{count}} event(s) not finished yet',
    seriesNoneUpcoming: 'No upcoming events',
    seriesFilterActive: 'Series: {{name}}',
    seriesFilterClear: 'Clear series filter',
    seriesField: 'Series',
    seriesFieldHint:
      'Optional. Use the same name for different editions of the same event; the calendar page groups them at the bottom.',
    seriesCreate: 'New series',
    /** Hitting `COLLATE NOCASE UNIQUE` on `POST /api/calendar/series` (`reason: 'series_name_taken'`). */
    seriesNameTaken: 'That series name is already taken.',

    // ---- Deleting a series (2026-09-13: the user chose cascade) ----
    /*
     * The row-level delete affordance. ⚠️ Owner only (the shared `canHardDelete`
     * predicate) — this removes every event in the series along with its revision
     * history, and events have no "hide first" step, so only one tier of the
     * repo's two-tier delete rule survives here.
     */
    seriesDelete: 'Delete',
    /*
     * ★ The two confirmations must stay separate, and both must **name the cost**.
     *
     * ⚠️ Not one generic "Are you sure?": the real risk is not a misclick, it is
     *    not knowing what gets taken along. So: no events ⇒ say plainly that
     *    nothing else is lost (so people dare press it); events ⇒ say **how many**,
     *    that the revision history goes too, and that it cannot be undone.
     *
     * ⚠️ `{{count}}` is i18next interpolation (single braces render literally).
     *    ⚠️ No Markdown `**` here — this string goes straight into a text node,
     *    so asterisks would show up verbatim.
     */
    seriesDeleteNone:
      'This series has no events yet, so deleting it removes nothing else. Delete it?',
    seriesDeleteSome:
      'This series still has {{count}} events. They will be deleted along with it, together with their revision history, and this cannot be undone. Delete anyway?',
    seriesDeleteBusy: 'Deleting…',
    seriesDeleteFailed: 'Could not delete',

    // -------------------------------------------------------------------------
    // Detail page
    // -------------------------------------------------------------------------
    openLink: 'Open the link',
    infoTitle: 'Event details',
    /*
     * ⚠️★ An `author` key ("Submitted by") used to live here; **removed
     *    2026-09-14** with requirement ⑦.
     *
     * Not because nothing used it — because it sat in the wrong place. Who
     * submitted an entry is a *review* fact (who proposed this revision, how
     * often they have been rejected), while a reader of the public page wants
     * to know what the event is and how to enter it. The review screen still
     * shows the author, which is where that question is actually asked.
     * ⚠️ It is hidden, not deleted: `calendar_events.author_id`, the audit log
     *    and the review queue all still carry it.
     */
    updatedAt: 'Last updated',
    infoId: 'ID',
    pastNotice:
      'This event has already finished. What follows is the information as it stood — kept because it is still worth reading.',
    pendingNotice:
      'An edit to this event (r{{revision}}) is waiting for review. Until it is approved, this page still shows the current version.',
    notPublished: 'This event is not on the site',
    notPublishedHint:
      'It may still be waiting for review, it may have been rejected, or this address may simply be wrong (visitors see "not found" for all of those). If you submitted it, you can open it from the edit page.',
    openEditor: 'Open the edit page',
    openItem: 'View the event page',

    // -------------------------------------------------------------------------
    // Submit / edit
    // -------------------------------------------------------------------------
    submitTitle: 'Submit an event',
    submitSubtitle:
      'Enter the time the organiser published, together with its time zone — that is the only way others can convert it correctly.',
    submitFlowNote:
      'Submitting puts this event into the review queue. Until it is approved it appears neither in the calendar nor in the ICS subscription.',
    doneTitle: 'Submitted, waiting for review',
    doneSub: 'Once approved it will appear in the calendar list and in the ICS subscription.',
    submitAnother: 'Submit another',
    editTitle: 'Edit event',
    editSubtitle:
      'This edit goes back into the review queue — until it is approved, the live version stays as it is.',
    editAction: 'Submit changes',
    editLiveUnchanged:
      'Submitting this change does not alter the live event straight away: it enters the pending queue and only replaces the current version once approved.',
    editDoneTitle: 'Changes submitted',
    editDoneSub:
      'This version is now in the pending queue. Until it is approved the live version is unchanged — you will not see your edits on the page yet.',
    editBusyNotice:
      'Another edit (r{{revision}}) is already waiting for review — only one pending edit per event is allowed, so a new one cannot be submitted yet. Try again once that one has been decided.',
    editBusyWhat: 'The version waiting for review',
    editNotFound:
      'No such event, or it is not yours yet (only the author can open an unpublished event).',
    reviewNote: 'Submitting puts it in the review queue; it goes live once approved.',

    // ---- Form field hints ----
    hintTitle:
      'Copy the name from the event announcement; Chinese or the original language is fine.',
    titlePlaceholder: 'e.g. MCSR Ranked Season 5 Playoffs',
    hintTitleEn:
      'Optional. It is never translated automatically — if you leave it empty, the English UI falls back to the title above.',
    titleEnPlaceholder: 'e.g. MCSR Ranked Season 5 Playoffs',
    hintAllDay:
      'An all-day event only needs a date — the time is fixed at 00:00, and a date picker cannot enter a clock time at all.',
    /*
     * ★ Match times (2026-09-13): the **real, multiple slots** (`slots` in the
     * model).
     *
     * This replaces the 015 free-text box (`hintScheduleText` +
     * `placeholderScheduleText`, both deleted) — "one slot per line" looked like
     * structured data while being unchecked text that could neither position the
     * event on the grid nor be filtered on. Now each slot has its own start and
     * end and is validated one by one (see the `superRefine` in
     * shared/calendar.ts).
     *
     * ⚠️ The hint has to say the split is **by run of days, not by match**: an
     *    event played over three weekends is three slots, not "three matches" —
     *    the count is for the calendar, not for a fixture list.
     * ⚠️ It also has to say the **time zone is filled in once, above**: giving
     *    every slot its own zone is the most natural and most annoying
     *    misreading, and once two zones are really in play the cross-zone
     *    conversion starts contradicting itself.
     */
    hintSlots:
      '(Add more if needed) one slot per stretch of days. The timezone above is filled in once.',
    addSlot: 'Add another time',
    removeSlot: 'Remove this time',
    /**
     * The **accessible name** of each slot group (`aria-label`).
     *
     * ⚠️ It has to carry "which slot": in a screen reader those "start / end"
     *    input pairs are indistinguishable, and without an index the user cannot
     *    tell which one they are editing.
     * ⚠️ `{{n}}` is i18next interpolation (single braces render literally, see
     *    `marks.favoriteCount`).
     */
    slotLabel: 'Time {{n}}',
    hintStartsAt: 'The time the organiser published — not the time in your own zone.',
    hintTimezone:
      'IANA zone name, e.g. Asia/Shanghai. Getting it wrong shifts the whole event by hours, and it will look completely normal.',
    /*
     * ⚠️★ Two keys used to sit here and were removed on 2026-09-13/14:
     *    · `hintEndsTz` ("Only change this when the end is in a different zone")
     *      — there is only **one** time zone for the whole event now (requirement
     *      ④, "set the zone once at the top"), so "the zone the end uses" does not
     *      exist and the sentence had nothing left to explain;
     *    · `stageNone` ("Not set") — the whole stage dimension is gone (see the
     *      note where the `stage.*` group used to be). It was on loan as the
     *      empty option of the series dropdown, and that now uses `seriesNone`:
     *      borrowing meant editing the stage wording silently changed the series
     *      dropdown, and the two have nothing in common beyond both saying "not set".
     */
    hintEndsAt:
      'Many events only publish a start time, so this can be left empty. When empty the event is a single point in time in the subscription.',
    hintEndsAtAllDay:
      'The end date means the last day covered. For a one-day event leave it empty — setting it to the start date is read as an end before the start.',
    hintLocation: 'The venue for an offline event, or the platform for an online one.',
    locationPlaceholder: 'e.g. Online / Shanghai',
    hintUrl: 'Link to the announcement, the sign-up page or the stream.',
    hintTags:
      'Pick at least one. An event with no tags is invisible on a page that filters by tag.',
    /*
     * The empty option of the series dropdown.
     *
     * ⚠️ It is deliberately **not** `dimNone` ("Not applicable / Any"):
     *    belonging to no series is the normal case, not a dimension that fails
     *    to apply (that is what the three rating dimensions are for).
     */
    seriesNone: 'Not set',
    /*
     * The two dimensions added by migration 011, plus the entry requirement
     * added on 2026-09-13 (`access`).
     *
     * ⚠️ The empty option deliberately does **not** reuse `seriesNone`'s wording
     *    ("Not set" vs "Not applicable / Any"): for a ranked milestone the level
     *    and scope genuinely do not exist, and telling someone they "did not set
     *    it" makes them feel they missed a field — so they pick one at random and
     *    the data gets polluted.
     */
    hintLevel: 'Optional. How competitive the event is — a ranked milestone can leave this empty.',
    hintScope:
      'Optional. Who can take part — not "where it is played", so it still means something for an online event.',
    /*
     * Entry requirement (the third dimension, added 2026-09-13).
     *
     * ⚠️ Keep it about *how you get in*, not about how competitive the event
     *    is: that is `level`. An amateur community event can still be
     *    invitation-only.
     */
    hintAccess: 'Optional. Qualifiers first, invitation only, or anyone can sign up.',
    /*
     * The detail half of the scope dimension — it only appears once a continent
     * or country is picked.
     *
     * ⚠️ Say that several can be picked: the case that drove this field was
     *    "Asia and Oceania" in one event.
     */
    hintScopeDetail: 'Optional. Pick which ones — several allowed.',
    dimNone: 'Not applicable / Any',
    descriptionPlaceholder:
      'Markdown supported. Say what the event is, how to take part, and anything to watch out for.',
    hintDescription: '{{used}} / {{max}} characters.',
    notePlaceholder:
      'e.g. the time comes from the organiser announcement; this is a community-run event.',
    hintNote:
      '{{used}} / {{max}} characters. Only reviewers see this — it never appears on the event page.',
    tzOffsetHint: 'This zone is currently {{offset}}.',

    // ---- Form validation ----
    //
    // ⚠️ None of these come from the schema. The schema's messages are hard-coded
    //    Chinese, and showing them verbatim would drop a Chinese sentence into the
    //    English UI — visible only when something fails. Mapping lives in
    //    components/CalendarForm.tsx (`issueText`).
    errTitleRequired: 'The title cannot be empty.',
    errTitleTooLong: 'The title is at most {{max}} characters.',
    errDescTooLong: 'The description is at most {{max}} characters.',
    errLocationTooLong: 'The location is at most {{max}} characters.',
    errUrlTooLong: 'That link is too long.',
    errNoteTooLong: 'A note to the reviewer is at most {{max}} characters.',
    errTagsMin: 'Pick at least one tag.',
    /**
     * Validation for the multiple match times (2026-09-13).
     *
     * ⚠️ The first two are **word-for-word the schema messages** (the min / max
     *    on `slots` in shared/calendar.ts) — they are duplicated so the English
     *    UI has something to say, rather than falling back to showing the
     *    server's hard-coded Chinese line.
     * ⚠️ The third is **not** the same kind: the schema reports the path
     *    `['slots', i, 'startsAtLocal']`, and the UI has to turn that into "slot
     *    i has no start". It is more specific than the two above and must not be
     *    merged into one "a field did not pass validation" — that would leave the
     *    user to work out which slot it meant.
     */
    errSlotsMin: 'At least one time is required',
    errSlotsMax: 'At most {{max}} times',
    errSlotStartRequired: 'This time is missing a start',
    errTzTooLong: 'That time zone name is too long.',
    errTzRequired: 'Enter the time zone (e.g. Asia/Shanghai).',
    /*
     * ⚠️★ Two keys used to sit here and were removed on 2026-09-13:
     *    `errStartRequired` ("Enter the start time.") — replaced by
     *    `errSlotStartRequired`, because with several slots "the start time is
     *    missing" has to say **which** slot, or you cannot find it among eight;
     *    and `errEndNeedsBoth` ("The end needs both a time and a time zone") —
     *    its premise is gone. It used to be possible to give an end time without
     *    an end zone; now there is one zone for the whole event, so that
     *    combination cannot even be constructed.
     */
    errInvalidTz: 'That time zone name is not valid — check the spelling (e.g. Asia/Shanghai).',
    errWallClock: 'The time format should be 2026-08-30T20:00.',
    errAllDayTime: 'An all-day event must be at 00:00.',
    errEndBeforeStart:
      'The end must be later than the start. The comparison is on the UTC instants — across zones the clock times read backwards.',
    errAllDayEndOrder:
      'The end date of an all-day event must be later than the start, and it means the last day covered. For a one-day event, leave the end date empty.',
    errGeneric: 'A field did not pass validation — check the ones marked above.',
    errAlreadyPending:
      'An edit is already waiting for review — only one pending edit per event is allowed.',
  },
  /**
   * Month grid and the top filter bar (calendar rework).
   *
   * A separate section rather than adding to `calendar`: that one already holds
   * 99 keys (form, card, detail page) and thirty more would disappear into it.
   * These two pieces are **one interface** — changed together, read together.
   */
  calendarGrid: {
    // ---- The two views ----
    viewMonth: 'Month',
    viewList: 'List',
    viewSwitchLabel: 'View',

    // ---- Month / year switching ----
    prevMonth: 'Previous month',
    nextMonth: 'Next month',
    prevYear: 'Previous year',
    nextYear: 'Next year',
    today: 'Today',
    pickMonth: 'Choose a month',

    // ---- The grid ----
    /*
     * ⚠️ The accessible name has to carry *what is on*, not just a day number:
     * a screen-reader user tabbing through the grid would otherwise hear 42
     * numbers, which is no information at all. Naming the first event at least
     * lets them decide whether this day is worth opening.
     */
    dayLabel: '{{date}}, {{count}} event(s), first is "{{first}}"',
    dayLabelEmpty: '{{date}}, no events',
    /** Collapsed overflow inside a cell. The `+` is part of the string. */
    moreCount: '+{{count}}',
    rangeCount: '{{count}} event(s) in this view',

    // ---- Selected-day panel ----
    dayPanelLabel: 'Events on the selected day',
    pickDayHint: 'Pick a day to see what is on.',
    noEventsOnDay: 'Nothing scheduled for this day yet.',
    addOnDay: 'Add an event on this day',

    // ---- Filter bar ----
    filterLevel: 'Level',
    filterScope: 'Scope',
    /*
     * ⚠️★ A `filterStage` key ("Stage") used to sit here; removed on 2026-09-13
     *    with that dimension (requirement ⑥). The bar is now **three** blocks:
     *    tags (multi-select) plus Level and Scope — where the scope *detail* is a
     *    subordinate row directly underneath, not a peer dimension.
     *    ⚠️ `apps/web/scripts/gridrender.tsx` has a negative assertion guarding
     *       "no trace of stage anywhere". It must **not** use this key as its
     *       needle any more — with the key gone, `t()` returns the key itself and
     *       the assertion silently becomes always-true. It uses literals instead.
     */
    /*
     * The second level of the scope filter — the row that only appears once a
     * continent or a country is picked.
     *
     * ⚠️ It is subordinate to `filterScope`, not a fourth peer dimension, so it
     *    sits directly under that row. It matches any of the event's detail
     *    values, so an "Asia and Oceania" event shows up whichever one you pick.
     */
    filterScopeDetail: 'Scope detail',
    /*
     * The entry-requirement row (2026-09-14: "put 参赛门槛 in the filter bar above
     * the calendar too").
     *
     * ⚠️ The dimension entered the *model* on 2026-09-13 (form select, card
     *    badge) but was deliberately left out of the filter bar, because nobody
     *    had asked for it. The next day the user did, so it is now the third
     *    single-select dimension.
     * ⚠️ The server has always accepted `?access=` (it goes through the same loop
     *    as level/scope), so this was a front-end wiring job, not a new endpoint.
     */
    filterAccess: 'Entry requirement',
    /*
     * ⚠️ This sentence exists to say that tags are not the same kind of filter
     * as the others. Without it, someone who picked "Professional" and then sees
     * amateur events (matched because a *tag* hit) has no way to work out why.
     * ⚠️★ It has to track the number of single-select dimensions: `scopeDetail`
     *    is a subordinate row of Scope (not a dimension of its own), so with the
     *    entry requirement added on 2026-09-14 there are **three**: Level, Scope
     *    and Entry requirement.
     */
    filterHint:
      'Tags are multi-select — any match shows. Level, Scope and Entry requirement are single-select.',
    filterReset: 'Clear filters',
    noTagsSelected: 'No tags selected.',
    noTagsHint: 'Turn at least one tag on to see events.',
  },
  /**
   * Video wall (M4).
   *
   * Q6: **posting makes a video visible immediately — there is no review.** The
   * wording has to make that plain: nobody should wonder whether their link is
   * waiting in a queue, or go looking for a "pending" state that does not exist.
   *
   * ⚠️ The other Q21 point: these are **content videos** (tutorials, montages,
   * match recordings), not live VODs. Avoid the words "stream" and "VOD" — they
   * would steer people towards pasting a Twitch live link, which is not what v1
   * is for.
   */
  videos: {
    // ---- Page shell ----
    /*
     * ⚠️★ This section's name has changed **twice**, and both rounds are worth
     * keeping because the lesson in the middle is real:
     *
     *   1. (earlier) 「视频」→「娱乐视频」 / "Videos" → "Entertainment videos",
     *      when `/videos` and the new Live section were split apart, so the two
     *      would not look the same in the sidebar. See docs/calendar-video-rework.md.
     *   2. (2026-09-14) **back to "Videos"**: the user asked for the left
     *      sidebar's 「娱乐视频」 to read 「视频」.
     *
     *   ⚠️ Round 1 only changed the **sidebar row** (`nav.videos`); this `title`
     *      stayed "Videos" — so one section was called "Entertainment videos" in
     *      the sidebar and "Videos" on the page itself. Round 2 removes that
     *      mismatch rather than renaming anything again.
     *   ⇒ A section has exactly **one** name (this `title`); the sidebar refers to
     *      it, it does not spell out a second copy.
     *   ⚠️ "Only the strings that name the section change" still holds, just in the
     *      other direction now: prose that said "Entertainment videos" says
     *      "the Videos section". The bare "wall" metaphor ("on the wall") stays —
     *      it describes the layout, not the name.
     */
    title: 'Videos',
    subtitle:
      'Bilibili and YouTube videos the community has posted — tutorials, montages, match recordings. Constantly changing. No login needed to watch. For live streams, see the "Live" section.',
    pasteAction: 'Post a video',
    viewAll: 'Videos',
    viewMine: 'My posts',
    /*
     * ★ The two top-level tabs (item 8, 2026-09-19): one page, two blocks, two buttons.
     * ⚠️★ Only the **left** button needs a new string here: the right one reads
     *    "Tracked creators", which is `tracked.title` (one thing must not have two names —
     *    the `<h2>` of that block uses the very same key, and both are visible at once:
     *    the tab at the top, the heading inside the block).
     * ⚠️ It does not mean "my posts" (that is `viewMine`) but **where this column's content
     *    comes from**: the wall is what people post, the other column is what the server
     *    fetches (the two paths of spec §8.1).
     */
    tabWall: 'Posted by users',

    // ---- Filters ----
    allPlatforms: 'All platforms',
    platformBilibili: 'Bilibili',
    platformYoutube: 'YouTube',
    platformTwitch: 'Twitch',
    authorFilter: 'Only {{name}}',
    clearAuthor: 'Clear author filter',
    clearFilters: 'Clear filters',
    resultCount: '{{count}} total',
    resultCountFiltered: '{{count}} matching',

    // ---- List states ----
    noResults: 'No videos on the wall yet',
    noResultsHint: 'Change the filters, or post one — it goes live immediately.',
    loadFailed: 'Failed to load',
    page: 'Page {{page}} / {{total}}',
    prevPage: 'Previous',
    nextPage: 'Next',

    // ---- Embedding ----
    play: 'Play',
    playHint: 'Click to load the third-party player',
    embedUnavailable: 'We cannot read the page domain, so this platform cannot be embedded here.',
    openOriginal: 'Open on the original site',
    startFrom: 'Starts at {{time}}',
    startIgnoredShort: 'This platform cannot seek; playback starts at 0',

    // ---- Form ----
    formTitle: 'Post a video',
    url: 'Video link',
    urlPlaceholder: 'Paste the link to one specific video',
    hintUrl:
      'A link to a **single video** on Bilibili / YouTube / Twitch. Channel, playlist and collection pages carry no video id.',
    recognized: 'Recognised {{platform}} · {{id}}',
    notRecognized: 'No video id recognised yet',
    titleLabel: 'Title',
    titlePlaceholder: 'What is this video about',
    hintTitle:
      'You write the title — we never fetch platform metadata, so the link cannot fill it in for you.',
    startOffset: 'Start time (optional)',
    startOffsetPlaceholder: '90 / 1:30 / 1:02:33',
    hintStartOffset: 'Playback starts here. 90, 1:30 and 1:02:33 are all accepted.',
    hintStartOffsetUnsupported:
      'This platform cannot seek: the value is saved, but it will not take effect during playback.',
    errStartOffset:
      'Wrong time format: use 90, 1:30 or 1:02:33. The parts after a colon cannot exceed 59.',
    errUrlRequired: 'Paste a video link.',
    errTitleRequired: 'The title cannot be empty.',
    action: 'Post to the wall',
    submitting: 'Posting…',
    noReview: 'Visible immediately: videos are not reviewed, there is no pending state.',
    doneTitle: 'It is on the wall',
    doneNote: 'There is no review step — your video is on the wall right now.',
    doneStartIgnored: 'The start time was saved, but this platform will not seek to it.',
    submitAnother: 'Post another',
    viewWall: 'Go to the wall',

    // ---- Errors ----
    errExistsVisible: 'That video is already on the wall.',
    errExistsHidden: 'That video was hidden, so the wall does not show it.',
    errExistsMine: 'That is the one you posted earlier.',
    mineNeedLogin: 'Seeing your own posts needs a login. Watching the wall does not.',
    gotoMine: 'Open my posts',

    // ---- Cards and after-the-fact actions ----
    postedAt: 'Posted {{date}}',
    mineBadge: 'Mine',
    hiddenBadge: 'Hidden',
    delete: 'Delete',
    hide: 'Hide',
    restore: 'Restore',
    busyDeleting: 'Deleting…',
    busyHiding: 'Hiding…',
    busyRestoring: 'Restoring…',
    confirmDelete: 'This removes the row for good and cannot be undone. Continue?',
    okDeleted: 'Deleted.',
    okDeleteNoop: 'It is already gone — the outcome you wanted has happened.',
    okHidden: 'Hidden. The wall no longer shows it; the author still can.',
    okHideNoop: 'It was already hidden.',
    okRestored: 'Restored.',
    okRestoreNoop: 'It was already visible.',
    actionFailed: 'The action failed',

    // ---- My posts ----
    mineEmpty: 'You have not posted a video yet.',
    mineEmptyHint: 'Post one — it goes live immediately.',
    mineHiddenNote: 'Hidden videos are only visible to you here; the wall does not show them.',
  },
  /**
   * Tracked creators (video tracking, T7) — the block added to the `/videos` page.
   *
   * It is a **different thing** from the `videos:` section above, hence a separate
   * namespace (the repo's rule: one section, one namespace — see `live` / `liveManage` /
   * `shares` / `ranked`):
   *   · `videos.*`  = videos people post themselves (`videos` table, hand-written title,
   *     no metadata fetched);
   *   · `tracked.*` = videos a scheduled job pulls for a list of creators
   *     (`tracked_videos` table, everything is fetched).
   * spec §8.1 says the two paths coexist; ruling R3 says the user-submitted path is
   * not touched at all.
   *
   * ⚠️ Two claims in this section must stay **true**; check the code before editing:
   *   1. "the list is maintained by content editors" — only `live.manage` can write
   *      `tracked_creators` (spec §7);
   *   2. the two tag numbers (60 s / 20 min) are spec §4.3's frozen criteria
   *      (`short` ≤ 60s, `long` ≥ 1200s), executed by `deriveTags` on the fetch side.
   *
   * ⚠️ This section deliberately uses **no** `**emphasis**`: the eight `tracked.err*`
   *    entries are dispatched through the `TRACKED_ERRORS` table in
   *    `lib/trackedErrors.ts` (not literal `t('…')` call sites), so a marker would need
   *    an entry in `services/api/src/i18n-keys.test.ts`'s `DYNAMIC_KEYS` allowlist.
   *    One pair of asterisks is not worth an exemption, so the whole section stays plain
   *    (the render self-check scans the products for a literal `**`).
   */
  tracked: {
    // ---- Public section (everyone sees it) ----
    title: 'Tracked creators',
    /*
     * ★ This sentence has to say **it is not the other tab, "Posted by users"**: two video
     *   blocks on one page that are not explained read as duplicates
     *   (`live.relationToVideos` exists for the same reason).
     * ⚠️★ Wording corrected 2026-09-19: since user item 8 these two blocks are the
     *   **two tabs at the top** (`videos.tabWall` / this section's `title`) and they
     *   render **exclusively** — "the wall above" no longer points at anything
     *   (that block is not on screen at all right now), and the value itself already
     *   says "Posted by users".
     * ⚠️ It also says who maintains the list — a visitor who cannot find their own post
     *   here otherwise assumes it was lost.
     */
    subtitle:
      'A scheduled job pulls these creators’ videos, newest first. The list is maintained by content editors — it is a different source from “Posted by users”, not the same list.',
    count: '{{count}} tracked',
    empty: 'No tracked videos yet',
    /*
     * ⚠️ The second sentence is not decoration: fetching runs on a **10-minute** timer,
     *   so "creators on the list but not one video yet" is a normal state (just added,
     *   or the last round failed). Without it, visitors think the block is broken and
     *   editors re-paste the same link.
     */
    emptyHint:
      'Nothing has been fetched for the creators on the list yet — fetching runs every 10 minutes.',
    /*
     * ★★ The empty sentence for **one partition** (`platform !== undefined`, the four
     *    buttons of spec §5.2) — it does a different job from the two above, and
     *    reusing them is wrong.
     *
     * ⚠️★ `emptyHint` names the cause as "nothing has been fetched / runs every 10
     *    minutes". Inside a partition the cause is often that **no creator of that
     *    platform is on the list at all** (two of the three platforms look like this
     *    today). Reusing it sends the reader off to wait for the crawler, and the
     *    crawler will never fetch a creator that is **not on the list** — pointing at
     *    an action that cannot succeed is worse than saying nothing, which is the whole
     *    reason this sentence exists.
     * ⚠️ It **replaces the second sentence**: a partition renders only this one (see
     *    `emptyTitle` in `TrackedVideos.tsx`), so it has to carry the "why" itself —
     *    both causes: no creator for this platform on the list, or nothing fetched yet.
     * ⚠️ It promises **no time**: fetching runs every 10 minutes, but "wait a bit and it
     *    will show up" is not necessarily true here (with no creator it never will).
     */
    emptyPlatform:
      'No videos on this platform yet — the list has no creator for it, or their videos have not been fetched yet.',
    /*
     * ★★ Item 9 (2026-09-19): the sentence for "empty **because of a filter**" — different
     *    from all three above.
     *
     * ⚠️★ The three ways of being empty are three different facts, and reusing any two of
     *    them sends the reader off to do something useless:
     *   · the "all" case (`empty` + `emptyHint`): nothing fetched for the creators on the
     *     list yet / fetching runs every 10 minutes — "wait and it will show up";
     *   · one **partition** (`emptyPlatform`): no creator of that platform is on the list
     *     at all — waiting will never help;
     *   · one **filter** (this sentence): the list **has** content, this condition filtered
     *     it away — the action is neither waiting nor switching platform, it is
     *     **loosening the condition**.
     * ⚠️ It promises **no time** ("wait a bit" would be a lie here: keep the condition and it
     *    stays empty forever), and it does not say the block is broken (this is its most
     *    normal kind of empty).
     * ⚠️ The criterion lives in `TrackedVideos.tsx` (`emptyTitle`): when
     *    `hasTrackedFilters(filters)` is true this sentence is used — and **sorting is not a
     *    filter** (it does not change the result set), so "empty after re-sorting" still says
     *    the block has nothing, not "nothing matches this filter".
     */
    emptyFilter: 'Nothing matches this filter — loosen it, or clear the filters and look again.',

    // ---- Item 9: the filter bar (five selects) ----
    /*
     * ⚠️★ These are the accessible names (`aria-label`) of the five comboboxes; the **visible**
     *    label is carried by the first option itself ("All time" / "All tags" …) —
     *    `routes/ResourceList.tsx` does exactly this (its select's label is its default
     *    option), and this column copies it rather than inventing a second control style.
     * ⚠️ The **numbers** behind the three time ranges and the four duration buckets are not in
     *    the dictionary: `TRACKED_TIME_RANGES` / `TRACKED_DURATION_PRESETS` in
     *    `packages/shared/src/tracking.ts` own them (a label table that drifts from the range
     *    table shows up as "I picked 1–5 minutes and got a different range", and that does not
     *    raise anything). The strings here only answer "how do we say it".
     */
    filterTime: 'Time range',
    filterTag: 'Tag',
    filterDuration: 'Length',
    filterSort: 'Sort',
    filterCreator: 'Creator',
    timeAll: 'All time',
    time7d: 'Last 7 days',
    time30d: 'Last 30 days',
    time1y: 'Last year',
    tagAll: 'All tags',
    durAll: 'Any length',
    /* ⚠️ The four buckets are **closed** intervals and do not overlap (see the preset table). */
    durLt1: 'Under 1 minute',
    dur1to5: '1–5 minutes',
    dur5to15: '5–15 minutes',
    durGt15: 'Over 15 minutes',
    /*
     * ⚠️ The two sort options have **no** "all" entry: a sort always has a current value
     *    (newest first by default). The first entry is that default, and when the value equals
     *    the default it is not written into the URL (a repo-wide convention).
     */
    sortNew: 'Newest first',
    sortViews: 'Most viewed first',
    creatorAll: 'All creators',
    /*
     * ★ The extra entry added when the roster has **no** row for the creator in the URL
     *   (review I2).
     *
     * ⚠️★ Why it must exist: `?tcreator=<id>` is a filter that is **already in effect** —
     *   the list really was filtered by it. When the roster failed to load, or an editor
     *   deleted that creator, there is no matching `<option>`, and the browser paints a
     *   `<select>` whose `value` matches nothing as its **first** option ("All creators")
     *   ⇒ the reader gets a very short list plus a dropdown that says "All creators", with
     *   **nothing on the page explaining why**. This entry makes the selected state match
     *   the fact: a creator really is selected, we just cannot name them right now.
     * ⚠️ It does not print the id: that is an internal key (`tracked_creators.id`) and means
     *   nothing to a reader. Nor platform/count — the roster did not give them, so we do
     *   **not** know (and 0 is not allowed to stand in).
     * ⚠️ Cost (accepted): it can only say "some creator is selected", not who; naming them
     *   would require a roster that contains them, and the roster is exactly what we could
     *   not read. Recorded in `docs/pending.md §5.103`.
     */
    creatorUnknown: 'Selected creator',
    /*
     * ★ One entry of the creator dropdown: name · platform (count).
     * ⚠️ The count is the number of **publicly visible** videos
     *    (`TrackedCreatorSummary.videoCount`); it answers "does this person have anything" —
     *    the list already contains creators with 0, and picking one only shows "nothing matches
     *    this filter", so the dropdown says it up front.
     * ⚠️ The name may be the handle instead (the view falls back when the display name is
     *    empty — see `creatorLabel`).
     */
    creatorOption: '{{name}} · {{platform}} ({{count}})',
    thumbAlt: 'Thumbnail of {{title}}',
    publishedAt: 'Published',
    duration: 'Length',
    views: 'Views',
    comments: 'Comments',
    /*
     * ⚠️★ The three pager strings ("Page X / Y", Previous, Next) are **reused from
     *  `videos.*`** — two pagers on one page describe the same thing, and a second set of
     *  sentences would only drift. The `aria-label` must differ, though: it is how a
     *  screen reader tells this page's two `<nav>` elements apart.
     */
    pagerLabel: 'Tracked videos pagination',
    tagLiveReplay: 'Live replay',
    /* ⚠️ The 60 s / 20 min numbers are the same fact as `deriveTags` (see above). */
    tagShort: 'Short (60 s or less)',
    tagLong: 'Long (20 min or more)',

    // ---- Manage panel (only `live.manage` sees it) ----
    manageTitle: 'Maintain the tracked list',
    /*
     * ⚠️ This says **who can see it** (the repo does this in `liveManage.subtitle` too):
     *    an editor who is not told otherwise assumes visitors see this table, including
     *    the "last error" column.
     */
    manageSub:
      'Only content editors see this block. Every 10 minutes the server pulls the videos of the creators on the list.',
    manageEmpty: 'The list is empty — paste a creator link above.',
    addLabel: 'Add a creator',
    addPlaceholder: 'https://space.bilibili.com/703007996',
    /*
     * ⚠️ The hint must say the **server** resolves the link, and that a failure will be
     *    spelled out: this field is not where you type an ID, and the answer for an
     *    unrecognised link (`tracked.errUnresolvable`) has to match this sentence.
     */
    addHint:
      'Paste a profile / channel page link, or an @handle. The server resolves the platform and the id — if it cannot, it says so explicitly.',
    addAction: 'Add',
    addBusy: 'Resolving…',
    /* ⚠️ An empty box is stopped **locally** (the same criterion as
       `TrackedCreatorInputSchema`'s `min(1)`): sending it only earns a guaranteed 400 whose
       message is a server-side field note — it cannot say what to paste. */
    errInputRequired: 'Need a link or an @handle.',
    colPlatform: 'Platform',
    colName: 'Name',
    colState: 'State',
    colSynced: 'Last synced',
    colError: 'Last error',
    colVideos: 'Videos',
    /*
     * ★ The **second half** of `N（hidden M）` (spec §5.4, first bullet): at M = 0 the
     *   whole bracket is not drawn (the render site reads
     *   `creator.hiddenCount > 0 ? … : null`).
     *
     * ⚠️ The parentheses are **not** in this sentence — they are layout, supplied by the
     *    render site. This string only answers "how do we say M".
     * ⚠️★ M is "how many of his rows the takedown check has **hidden**"
     *    (`status = 'hidden'`), **not** a difference: the `N` above still counts **all**
     *    of his rows (hidden ones included, spec §5.4 last ⚠️) — the two numbers count
     *    different things, so `137（hidden 3）` reads "137 stored, 3 of them not shown".
     */
    hiddenCount: 'hidden {{count}}',
    colActions: 'Actions',
    stateOn: 'Enabled',
    stateOff: 'Disabled',
    /*
     * ⚠️ "N failures in a row" has to be visible (spec §6.3): bilibili's risk control is
     *    **probabilistic**, so "no new videos today" and "nothing was fetched today" look
     *    identical in the logs.
     */
    failStreak: '{{count}} failures in a row',
    /*
     * ★★ The cooldown window (migration 022, the ruling recorded in
     *    `docs/pending.md` §5.98): after `COOLDOWN_AFTER_FAILURES` (3) consecutive failures the
     *    creator is **not picked for an hour** (frozen `COOLDOWN_SEC = 3600`; both constants live
     *    in `services/api/src/tracked-videos.ts` and in the spec §10 table).
     *
     * ⚠️★ This sentence is the **only** place that state becomes visible: while a creator is
     *    cooling down the sync sends **no request at all** (they are not even in the due list),
     *    so the logs show not one failure — without this the symptom is "that column stopped
     *    updating and nothing was recorded anywhere".
     * ⚠️ `{{until}}` is an **already formatted** timestamp (the render site converts it from
     *    **seconds** with `localDateTime`): this string must not format a date itself, and must
     *    not build one with `new Date` — both are entrances to "forgot the ×1000 ⇒ 1970".
     * ⚠️ One sentence, not two: it sits right under "last error" as a single small line.
     * ⚠️ It does not replace `failStreak` — that one says how many times, this one says until
     *    when. Past three failures both are shown, which is correct (the counter stops climbing
     *    at 3+, while the deadline lives here).
     */
    cooldown: 'Cooling down until {{until}}',
    disable: 'Disable',
    enable: 'Enable',
    rebackfill: 'Re-backfill',
    rebackfillHint: 'Fetch this creator’s entire history again (takes effect next round)',
    /*
     * ⚠️ Deleting must say **the videos go too**: the foreign-key cascade (spec §4.2) is
     *    not obvious, and it makes this step irreversible (rebuilding it means re-adding
     *    the creator and waiting out a full backfill).
     */
    confirmDelete: 'This deletes the creator and their videos. Continue?',
    delete: 'Delete',

    /*
     * ---- What the panel says after an action ----
     * ⚠️ Each one has to say **what happens in the next round**: nothing on this panel
     *    takes effect immediately (fetching is a background job on a 10-minute timer).
     * ⚠️★ `okRebackfill` especially cannot be dropped: re-backfilling writes
     *    `backfill_done`, and the table has **no column for it** ⇒ without this sentence
     *    the button is **silent** (people click it three times and conclude it is broken).
     */
    okAdded: 'Added — the next round pulls their videos (a round runs every 10 minutes).',
    okDisabled: 'Disabled — the server stops fetching them; videos already fetched are kept.',
    okEnabled: 'Enabled — the next round starts fetching them again.',
    okRebackfill: 'Queued for another backfill — the next round fetches their whole history again.',
    okDeleted: 'Deleted — their videos are gone too.',

    /*
     * ---- Failure sentences (keyed by `TRACKED_ERRORS` in `lib/trackedErrors.ts`) ----
     *
     * ⚠️★ These eight are **not** called with a literal `t('…')` at the render site; they
     *   are dispatched through that **exported** table (the reason is in the table's own
     *   comment: the render self-check asserts every cell). So
     *   `services/api/src/i18n-keys.test.ts`'s literal scan cannot see them — their
     *   existence is pinned cell by cell in `apps/web/scripts/videorender.tsx`,
     *   in both languages.
     *
     * ⚠️★ Every sentence has to point at the **right** thing; that is the whole point of
     *   this batch (handed over from T5):
     *   · `platform_not_configured` is **our** missing credential, not the editor's bad link;
     *   · `creator_not_found` means "that link points at somebody who does not exist"
     *     (fix the link);
     *   · `rate_limited` **must not promise a number of seconds** (see below).
     */
    errPlatformNotConfigured:
      'This platform has no fetching credential on our side — it is not your link, and re-pasting it will not help.',
    errCreatorNotFound: 'Upstream says there is no such person — check the link for a typo.',
    errUnresolvable:
      'This link does not look like a creator on any platform we know — paste a profile / channel page link, or an @handle.',
    errDuplicate: 'That creator is already on the list (see the table below).',
    /*
     * ⚠️★ This sentence **has no number**, unlike the site-wide `auth.rateLimited`
     *    ("try again in {{seconds}} seconds"): that 60 comes from `Retry-After`, and this
     *    endpoint **does not send that header** (see the header of `routes/tracking.ts`:
     *    bilibili's risk control is probabilistic, nobody knows when it lifts). Inventing
     *    a number promises something we cannot deliver — the user waits it out, gets 429
     *    again, and concludes the feature is broken.
     */
    errRateLimited:
      'Upstream is throttling us — try again later. We cannot say how long, so we do not print a number.',
    errUpstreamBad:
      'That round with upstream did not work out (a failed handshake, or a reply we could not read) — try again later; if it keeps happening, somebody needs to look at our code.',
    errForbidden:
      'Your editing permission seems to have changed — reload the page, or sign in again.',
    errNotFound: 'That row is gone (another editor may have just deleted it) — reload to see.',
  },
  /**
   * Ranked Seeds search page (M4).
   *
   * ⚠️ Two numbers in this section must stay **true**:
   *   · "upstream covers roughly 80% of historical matches" — so "not found" is
   *     a normal outcome, not an error
   *   · "N match(es) for the current filters" — comes from `availableCounts`.
   *     Do not substitute another number for it (especially not "how many rows
   *     we returned", since a random query returns exactly one).
   */
  seedsPage: {
    /*
     * ---------------------------------------------------------------------------
     * Why this section contains **no** "data may be delayed" notice
     * ---------------------------------------------------------------------------
     * The upstream's v2.html claims `/seedinfo` "may lag by several days", but the
     * owner corrected that on 2026-09-12: both endpoints are live, the doc simply
     * was not updated (see docs/m4-decisions.md Q18 and docs/ranked-seeds-api.md §3).
     *
     * A false notice is worse than none: it teaches people to distrust a number
     * that is actually accurate, and somebody has to keep maintaining the sentence.
     */
    title: 'Ranked seed search',
    subtitle:
      'Draw a random seed from the upstream ranked pool by structure, variation and completion time — or look up the seeds of one match by its ID.',

    /**
     * ⚠️ The "~80%" figure must stay **true** (upstream's own claim). Its whole job
     * is to let someone whose match lookup 404s understand immediately that this is
     * normal rather than a broken site.
     */
    coverage:
      'Upstream covers roughly 80% of historical matches, so "that match is not there" is normal — not a failure.',

    // ---- Search ----
    searchTitle: 'Draw one at random, with filters',
    searchHint:
      'Filters only pick which seed you get; they never change the seed itself. Want pure chance? Select nothing.',
    randomAction: 'Random one',
    searchAction: 'Random one matching the filters',
    searching: 'Searching…',
    /*
     * This is a **behaviour** note, not decoration: the UI chooses the endpoint for
     * you (no filters → /random, filters → /search), and you deserve to know that
     * happened.
     */
    filterNote:
      'With no filters this uses upstream\'s "random" endpoint; as soon as you pick a filter it switches to the search endpoint.',

    /*
     * ⚠️ Ten entries used by the **old** panel (two selects + a collapsed chip wall)
     *    were deleted here together with that panel (Task 6):
     *      filterOverworld / filterNether / filterAny / variations /
     *      variationsHint / variationsExpand / variationsCollapse /
     *      variationsClear / variationsSelected (with {{count}}) / variationsSource.
     *
     *    The rule is this repo's existing one: **a key exists if and only if a real
     *    state needs it** (`progress.md` §十五 c). Their only reference site was the
     *    deleted `apps/web/src/components/SeedFilters.tsx` (checked key by key with
     *    git grep).
     *
     *    ⚠️ Their replacements are pickOverworld / pickVariations / pickBastionBiome /
     *       pickBastionType / pickBastionVariations / pickFortressBiome / pickLegend /
     *       pickSlow (added by Task 4). Do not add the old names back: with both
     *       present, the next person editing copy will edit the one that is not
     *       rendered, and nothing on screen will change.
     */

    completion: 'Completion time, at most',
    completionPlaceholder: 'm:ss, e.g. 2:35',
    completionHint:
      'Only returns ranked seeds finishing within this time. Leave empty for no limit.',

    hits: '{{count}} match(es) for the current filters',
    /**
     * `availableCounts` is number | null. **Never render 0 when it is missing** —
     * 0 asserts "nothing matches", while we are holding a matching seed in our hand.
     */
    hitsUnknown: 'Upstream did not report a match count',

    // ---- Result ----
    resultTitle: 'Result',
    resultEmpty: 'No result yet. Hit the button above to draw one.',
    /**
     * ⚠️ Once the filters change, the seed on the card **no longer corresponds** to
     * them. Without this line the user will assume it satisfies the current
     * selection: nothing on the page looks wrong, what went unrecorded is which
     * query that result belongs to — and they will take a seed that does not match
     * their expectations into a world, with almost no way to find the real cause.
     */
    resultStale:
      'The seed above was drawn with the **previous** filters. You have changed them, so press the button again to draw under the new ones.',
    matchIdLabel: 'Match ID',
    matchDateLabel: 'Match time',
    matchDateUnknown: 'Upstream did not report a match time',
    overworldSeed: 'Overworld',
    netherSeed: 'Nether',
    theEndSeed: 'The End',
    theEndMissing: 'Upstream did not provide a seed for The End',
    /**
     * ⚠️ The copy button is not a nicety: a seed is 19 digits
     * (`7304888896886165976`). Nobody types that into Minecraft by hand, and one
     * wrong digit generates a completely different world.
     */
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed — select the digits and copy them manually',
    viewInfo: "Show this match's structure and variations",
    loading: 'Loading…',

    infoTitle: 'Structure and variations',
    infoOverworld: 'Overworld structure',
    infoNether: 'Nether bastion',
    infoEndTowers: 'End towers',
    infoVariations: 'Variation entries',
    infoNone: 'None',
    infoNoVariations: 'This match has no variation entries',
    endTowersHint: 'Y coordinates of the End towers (there can be several)',
    /**
     * ⚠️ Variation entries are shown **raw**, never upper-cased.
     *
     * They are namespaced ids (`biome:structure:plains`); upper-casing them stops
     * them matching upstream — and the page still looks perfectly fine, it just
     * returns nothing. See `SeedInfo.variations` in packages/shared/src/seed.ts.
     */
    variationsRawNote: 'Entries below are shown exactly as upstream sends them; the case matters.',

    // ---- Look up by match ID ----
    lookupTitle: 'Look up by match ID',
    lookupHint:
      'The three seeds that match actually generated. The same ID always gives the same values.',
    lookupAction: 'Look up',
    lookupBusy: 'Looking up…',
    matchIdPlaceholder: 'e.g. 3650001',
    matchIdRange: 'Seed data starts at match ID {{min}}.',

    /**
     * ★ A 404 here is a **normal outcome**, not an error (upstream covers ~80%).
     *
     * So this group of strings has to do two things: make it clear that nothing is
     * wrong with the user or with us, and offer the **next step** (submitting the
     * record) — which is exactly why Q15 exposes the write endpoint at all.
     */
    notFoundTitle: 'That match is not in the upstream seed database',
    notFoundBody:
      'Upstream covers roughly 80% of historical matches, and this one is in the other 20%.',
    notFoundInfoHint:
      '"Structure and variations" has a lower floor than the seed values (from {{min}}), so try that first.',
    infoOnlyAction: 'Look up structure and variations only',

    // ---- Search failures ----
    /*
     * ⚠️ `seed_not_found` and `no_match` share one error code and are told apart by
     *    `reason`, and the **next step is completely different**:
     *      · seed_not_found (no reason) → the match is not there → submit it
     *      · no_match                   → the filters are too narrow → relax them
     * Swap these two and the user will try to submit a match that merely had
     * over-tight filters.
     */
    errNoMatch: 'No single seed satisfies all of these filters',
    errNoMatchHint:
      'Relax a couple of filters and try again: drop a variation or two, or clear the completion limit.',
    errUnavailable: 'The seed service is temporarily unavailable',
    /**
     * ⚠️ 502 means "our upstream broke", not "we are down for maintenance", so it
     * **promises no recovery time** — inventing one promises something we cannot
     * keep (the server comment gives the same reason).
     */
    errUnavailableHint:
      'This is a problem on the upstream side, not a mistake on yours. Try again shortly.',
    /*
     * ---- This instance has no upstream configured (503 `seed_not_configured`) ----
     *
     * ⚠️ The two sentences above are about **the upstream**; these two are about
     * **this deployment**. The reader's next step is opposite in each case — wait,
     * versus go and set an address — and this state is now the **default** one
     * (the upstream address has no default), so for a self-hoster it is likely the
     * first thing they see. One sentence has to say both "you did nothing wrong"
     * and "waiting will not help".
     */
    errNotConfigured: 'This instance has no seed data source configured',
    errNotConfiguredHint:
      'This is not a mistake on your side and not a temporary fault — retrying will not change it. Someone needs to configure the upstream address for this site (MCSR_SEED_API_BASE).',
    errRate: 'Too many requests. Try again in {{seconds}} seconds.',
    errGeneric: 'The search failed',
    /**
     * This one is theoretically **unreachable**: it signals that the UI sent filter
     * parameters to /random. It still gets its own sentence, because if it ever
     * appears it means we wired the wrong endpoint — and the generic fallback would
     * dress a real bug up as "the service failed", letting it live much longer.
     */
    errUseSearchEndpoint:
      'The page sent filter parameters to the wrong endpoint (that is our bug) — please report it.',

    errMatchIdFormat: 'A match ID can only contain digits',
    errMatchIdTooSmall:
      'Seed data starts at match ID {{min}}; earlier matches have no seed values.',

    errBadOverworld: 'That overworld structure value is not accepted',
    errBadNether: 'That nether structure value is not accepted',
    errFilterTooLong: 'The variation filter is too long (over 512 characters)',
    errFilterBadChars: 'The variation filter contains characters that are not allowed',
    /**
     * `end_spawn:*` is buggy upstream (Q17), so it never appears in the vocabulary.
     * This sentence exists for a hand-built URL — and it must say the second half
     * too: the variation **exists**, it just cannot be used as a filter.
     */
    errEndSpawnUnsupported:
      'The end_spawn group is buggy upstream and cannot be used as a filter (it still shows up in results).',
    errCompletionFormat: 'Use the form "m:ss", for example 2:35',
    errCompletionSeconds:
      'Seconds can only be 00–59. Carry anything over 59 into the minutes (1:75 should be 2:15).',
    errCompletionTooLong: 'At most 24 hours.',
    errBadCompletion: 'The completion limit is not a valid number of milliseconds',

    // ---- Submitting a record (the write endpoint, Q15) ----
    saveTitle: 'Submit a record',
    saveIntro:
      "Record a match's seed values into the upstream database. This is the only way to fill in the missing 20%.",
    /**
     * ★ This has to be prominent, and it has to sit **above the button**.
     *
     * This is the only place on the whole site where a user's click mutates somebody
     * else's production data. They are entitled to know that before pressing it —
     * not to find out afterwards.
     */
    saveWarning:
      "Heads up: this button writes **straight into the upstream operator's database**, not into our site. It is the only place here that touches somebody else's production data, which is why it requires a login, a verified email, and has a quota of 10 per hour.",

    saveNeedLogin: 'Submitting writes into the upstream database, so it needs a login.',
    saveNeedVerify: 'Submitting needs a verified email — otherwise anyone could write there.',
    saveNeedCapability: 'Your account does not currently have permission to submit.',
    saveNeedLoginAction: 'Log in',
    saveNeedVerifyAction: 'Verify email',

    saveMatchId: 'Match ID',
    saveOverworldSeed: 'Overworld seed',
    saveNetherSeed: 'Nether seed',
    saveTheEndSeed: 'The End seed',
    saveTheEndHint: 'Optional. Leaving it empty means the field is simply not sent.',
    saveMatchDate: 'Match time',
    saveMatchDateHint:
      'Optional. ISO-8601 or a millisecond timestamp (the upstream schema takes a string).',
    /**
     * ⚠️ Seed inputs must be **text** fields (inputMode="text"), never number fields.
     *
     * `type="number"` breaks on large integers, and it breaks **silently**:
     * `Number('7304888896886165976')` does not throw, it just hands you a seed whose
     * tail became 000. See the header of packages/shared/src/seed.ts.
     */
    saveSeedHint:
      'A 64-bit integer, negatives allowed. Surrounding spaces are fine and are stripped.',

    saveAction: 'Write to the upstream database',
    saveBusy: 'Writing…',
    saveCancel: 'Cancel',
    saveDone: 'Written: match {{matchId}}',
    /**
     * ⚠️ The quota counts **successful writes**, not attempts.
     *
     * That is unusual enough to state in the UI: otherwise somebody who mistyped a
     * field a few times and got locked out for an hour will conclude the typos were
     * the cause — when the truth is the opposite.
     */
    saveQuotaNote:
      'The quota is 10 **successful writes** per user per hour. A field that fails validation does not consume it, so a rejected submission will not get you rate limited.',

    saveErrExists: 'That record already exists',
    saveErrExistsHint:
      'Upstream already has this match ID, so there is nothing to add. Just look it up.',
    saveErrDisabled: 'We have switched submissions off for now',
    /**
     * ⚠️ The 503 is an operator switch (`MCSR_SEED_WRITE_ENABLED` — **off by default**;
     * unset means no writes), **not** a permission problem (that one is 403/401).
     * The server deliberately sends no Retry-After: nobody knows when it will be on.
     */
    saveErrDisabledHint:
      'This is an operator switch, not a problem with your account. We do not know when it reopens, so we are not giving a time.',
    saveErrBody: 'The request body is malformed (that is our bug) — please report it.',
    saveErrMatchId: 'Needs a match ID of {{min}} or higher',
    saveErrOverworldSeed: 'Not a valid seed: needs a 64-bit integer',
    saveErrNetherSeed: 'Not a valid seed: needs a 64-bit integer',
    saveErrTheEndSeed: 'Not a valid seed: needs a 64-bit integer, or leave it empty',
    saveErrMatchDate: 'Bad time format: ISO-8601 or a millisecond timestamp',
    /**
     * ⚠️ The fallback must admit that we **did not get** which field it was, rather
     * than pretending to know.
     *
     * The server's 400 carries a machine-readable `reason` (see `invalidInput` in
     * routes/seeds.ts) but the client cannot see it yet — see `ApiError` in
     * lib/api.ts, whose constructor has no `reason`. Until that is plumbed, this
     * sentence is the **accurate** description rather than a vague generic error.
     */
    saveErrUnknownField:
      'The server rejected one of the fields, but we did not receive which one. Please check the values above.',

    // ---- Community seed sharing (Q7/Q8: deliberately left empty) ----
    /**
     * ★ This block has to read as "not built yet", not as "broken".
     *
     * The three sentences each do one job: what it will be, why it is not here yet,
     * and an explicit statement that it is not a failure. **No buttons at all** — a
     * button that does nothing is more confusing than a block of prose.
     */
    communityTitle: 'Community seed sharing · coming soon',
    communityBody:
      'Seeds with fixed templates that the community submits itself (the RSG / SSG kind) are planned for later.',
    communityWhy:
      'This version gets "search the ranked seeds upstream already has" right first — it sits on roughly 3 million real rows. Community sharing is a different animal: we would store the content, review it, and own its long-term validity.',
    communityNote:
      'This is not broken, it is not built yet. Browse and submit entries will appear here when it ships.',

    // ---- The variation vocabulary (spec §5) ----
    /**
     * ★ The variation vocabulary — **the block the owner will edit** (spec §5).
     *
     * ⚠️★ **The values here are still the raw upstream identifiers, and that is deliberate.**
     *    On 2026-09-18 the owner translated the **Chinese** side into readable text
     *    (`village.desert` went from `biome:structure:desert` to 「沙漠」) and **left this
     *    side alone** — English keeps showing identifiers today. So the two locales no
     *    longer read alike: an English visitor sees `nether.find_bastion` where a Chinese
     *    one sees 「进入堡垒遗迹」. The cost and what would close it are recorded in
     *    `docs/pending.md`; nothing here has to change until the owner says so.
     *    ⚠️ This paragraph used to claim "both languages carry the **same** English string
     *    (R6 / spec §5.1)" — **that is no longer true**: the key, not the value, is what
     *    maps an entry to upstream (`seedPicker.ts`'s `labelKey` field). Do not reason
     *    from the old sentence.
     *    ⚠️ A second reason in that old paragraph was copied word for word from
     *    `ranked/timeline.ts` ("when the value *is* the identifier, in-the-table and
     *    not-in-the-table cannot look like two different things") — it never held here:
     *    a missing key makes i18next return the **key**, so the page prints
     *    `seedsPage.variation.…`, which is visibly different from any value.
     *
     * ⚠️ The key rule has **no exceptions**: `seedsPage.variation.<context>.<shortName>`.
     *    So `chest:structure:diamond` is **three keys** under village / desertTemple /
     *    shipwreck, each holding the same English today — the ruling in spec §5.3, and the
     *    **duplication is deliberate**. The cost is on the record: a reword means three
     *    edits; to merge them later, point those three `labelKey`s at one key in
     *    `seedPicker.ts` and this block does not change at all.
     *
     * ⚠️ Bastion subtypes are **keyed separately** (spec §5.2, the owner asked for it):
     *    `bastion:single:1` is **two keys** under bridge and stables. In the upstream docs
     *    stables' `single:1/2/3` are double-chest towers and `small_single:1/2/3` are
     *    single-chest towers — a shared key would show one word for two different things,
     *    and nothing would report it (probes ⑩/⑪: the same entry yields different match
     *    counts under the two types, so they really are two things). ⚠️ The render check now
     *    asserts the "two chips in one row never say the same thing" half of that for
     *    **both** languages (`seedsrender.tsx` ⑥); identical words **across** rows stay legal.
     *
     * ⚠️ Every key here is copied from the `labelKey` field of the table in
     *    `packages/shared/src/seedPicker.ts`. **A missing one reports nothing** — i18next
     *    returns the key itself for an unknown key, so the page prints
     *    `seedsPage.variation.village.snowyTundra`. Change that table, change this block.
     */
    variation: {
      // Overworld · village (upstream overworld=village)
      village: {
        desert: 'biome:structure:desert',
        plains: 'biome:structure:plains',
        savanna: 'biome:structure:savanna',
        snowyTundra: 'biome:structure:snowy_tundra',
        taiga: 'biome:structure:taiga',
        diamond: 'chest:structure:diamond',
        obsidian: 'chest:structure:obsidian',
      },
      // Overworld · desertTemple (upstream overworld=desert_temple)
      desertTemple: {
        diamond: 'chest:structure:diamond',
        egap: 'chest:structure:egap',
      },
      // Overworld · shipwreck (upstream overworld=shipwreck)
      shipwreck: {
        carrot: 'chest:structure:carrot',
        diamond: 'chest:structure:diamond',
        normal: 'type:structure:normal',
        sideways: 'type:structure:sideways',
        upsidedown: 'type:structure:upsidedown',
      },
      // Overworld · ruinedPortal (upstream overworld=ruined_portal)
      ruinedPortal: {
        egap: 'chest:structure:egap',
        goldenCarrot: 'chest:structure:golden_carrot',
        lootingSword: 'chest:structure:looting_sword',
        completable: 'type:structure:completable',
        lava: 'type:structure:lava',
      },
      // Bastion · bridge (upstream nether=bridge)
      bridge: {
        single1: 'bastion:single:1',
        single2: 'bastion:single:2',
        triple1: 'bastion:triple:1',
        triple2: 'bastion:triple:2',
      },
      // Bastion · housing (upstream nether=housing)
      housing: {
        single1: 'bastion:single:1',
        triple1: 'bastion:triple:1',
        triple2: 'bastion:triple:2',
      },
      // Bastion · stables (upstream nether=stables)
      stables: {
        goodGap1: 'bastion:good_gap:1',
        goodGap2: 'bastion:good_gap:2',
        single1: 'bastion:single:1',
        single2: 'bastion:single:2',
        single3: 'bastion:single:3',
        smallSingle1: 'bastion:small_single:1',
        smallSingle2: 'bastion:small_single:2',
        smallSingle3: 'bastion:small_single:3',
        triple1: 'bastion:triple:1',
        triple2: 'bastion:triple:2',
        triple3: 'bastion:triple:3',
      },
      // bastion biomes — one top-row choice, the whole id goes into upstream variations= (spec §4.2)
      bastionBiome: {
        basaltDeltas: 'biome:bastion:basalt_deltas',
        crimsonForest: 'biome:bastion:crimson_forest',
        netherWastes: 'biome:bastion:nether_wastes',
        soulSandValley: 'biome:bastion:soul_sand_valley',
        warpedForest: 'biome:bastion:warped_forest',
      },
      // fortress biomes — same shape, the ids are biome:fortress:*
      fortressBiome: {
        basaltDeltas: 'biome:fortress:basalt_deltas',
        crimsonForest: 'biome:fortress:crimson_forest',
        netherWastes: 'biome:fortress:nether_wastes',
        soulSandValley: 'biome:fortress:soul_sand_valley',
        warpedForest: 'biome:fortress:warped_forest',
      },
    },

    // ---- The new picker panel and its two tabs (spec §6.1 / §6.2) ----
    /**
     * These are **real prose** (not upstream identifiers), so every new sentence has to
     * re-run the font coverage check: `pnpm -F @mcsr/web check:font` (adding glyphs is a
     * manual step, not something a string here can fix).
     *
     * ⚠️ `pickSlow` is not decoration (spec §3.3): a query with variations / without
     *    measured 3.2–4.1 seconds. Without that sentence people start clicking again at
     *    second two, and every click is another query against the upstream single-core box
     *    — on a quota of 20 per IP per minute.
     * ⚠️ `pickLegend` for the same reason is not polish: the three states are carried by
     *    **colour alone** (green / red / grey), which says nothing to a colour-blind user,
     *    so the visible legend is part of that design.
     * ⚠️ Which pieces borrow entries from **elsewhere** (spelled out: the owner is about to
     *    hand-translate this block, and the old sentence would have sent them after the
     *    wrong entries):
     *      · the **5 option buttons of the overworld row** and the **4 of the bastion-type
     *        row** reuse `seedsPage.structure.*` (Village / Bridge / …) — they take the
     *        structure table's `labelKey`, so there are no entries for them here; do **not**
     *        copy them a second time;
     *      · the two **biome** rows (bastion / fortress) use `seedsPage.variation.*` (above);
     *      · the four row **labels** are neither here nor above — they are the new keys
     *        right below (`pickOverworld` / `pickBastionBiome` / `pickBastionType` /
     *        `pickFortressBiome`).
     *    ⚠️ This sentence used to read "the four top rows **reuse** `seedsPage.structure.*`"
     *      and then cite the **five buttons** — **both halves were wrong** (caught in the
     *      final review).
     */
    tabWorld: 'World seeds',
    tabRng: 'RNG seeds',
    tabHint: 'Switch between the two sections with the tabs above.',
    pickOverworld: 'Overworld structure',
    pickVariations: 'Structure variations',
    pickBastionBiome: 'Nether bastion · Biome',
    pickBastionType: 'Nether bastion · Type',
    pickBastionVariations: 'Bastion variations',
    pickFortressBiome: 'Fortress · Biome',
    pickLegend: 'One click = require (green) · two = exclude (red) · three = clear',
    pickLegendNote:
      'Only one "require" per exclusive group; "exclude" is not exclusive, so it can sit next to a "require".',
    pickHint: 'Set what you want, then press the button below to draw one.',
    pickSlow:
      'A search with variations or exclusions takes 3–4 seconds. Upstream is slow to work it out; it is not stuck.',
    rngTitle: 'RNG seeds',
    rngBody: 'This section is not built yet.',
    rngWhy:
      'It would filter for the random-number things (zero-cycle towers, before/after dragon and so on), and upstream has no endpoint for that yet.',

    // ---- Structure names ----
    /**
     * Structure names — the values are **upper-case** (both the owner's own database
     * and upstream's `seedinfo` use upper case; only the outbound filter parameters
     * are lower case, and the server does that conversion). Values missing from this
     * table fall back to the raw English name rather than rendering blank.
     */
    structure: {
      VILLAGE: 'Village',
      DESERT_TEMPLE: 'Desert temple',
      RUINED_PORTAL: 'Ruined portal',
      SHIPWRECK: 'Shipwreck',
      BURIED_TREASURE: 'Buried treasure',
      JUNGLE_TEMPLE: 'Jungle temple',
      BRIDGE: 'Bridge',
      HOUSING: 'Housing',
      STABLES: 'Stables',
      TREASURE: 'Treasure room',
    },
  },
  /**
   * How the "Videos" section differs from "Live"
   * (see docs/calendar-video-rework.md).
   *
   * ⚠️ Only that division of labour lives here — what the section is **called**
   *    comes from one place, `videos.title` (that name changed twice; the lesson
   *    is recorded there).
   */
  enterVideo: {
    /*
     * The one line on the entertainment-video page that points at 「直播」.
     *
     * ⚠️ Both sections are "videos", so something has to explain **why there are
     *    two** — otherwise either page looks like a duplicate of the other. The
     *    split is real and deliberate: that one is rolling (anyone can post, it
     *    changes constantly), this one is a slow-moving list a few editors keep.
     */
    pointingToLive:
      'Looking for live streams? Head to the "Live" section — a curated list of streamers.',
    gotoLive: 'Go to Live',
    /*
     * ⚠️ Strictly this belongs in the submit-resource section (`submit.*`); it
     *    lives here only because those are the sections I could edit this round,
     *    and this is UI text **about video**. `submit.hintKindVideo` would be a
     *    better home next time the strings are reorganised.
     */
    resourceKindHint:
      'Paste a link to a single Bilibili / YouTube video and the detail page will embed a player. Any other link is an ordinary resource with just an outbound link.',
  },
  /**
   * The "Live" section — an editor-maintained list of MCSR streamers.
   *
   * ⚠️ Two things in this section must stay **true**:
   *   1. **It lists channels, not individual streams.** Every row points at a
   *      channel, not "the stream that happens to be on right now". Wording
   *      that implies otherwise is something the user notices within a week.
   *   2. **Only YouTube actually embeds** (Twitch / Bilibili are recorded but
   *      not embedded). That is deliberate: Twitch has not been tested, and
   *      there is no evidence Bilibili live can be embedded — and getting it
   *      wrong shows up as a **black rectangle**. So the UI has to say "this
   *      takes you to the channel" rather than letting people think the player
   *      is broken.
   */
  live: {
    // ---- Page shell ----
    title: 'Live',
    subtitle: 'MCSR streamer channels worth following.',
    /*
     * ★★ The single most important line in this section — **rewritten 2026-09-18**,
     * because what it used to promise was overturned by the user's item 10.
     *
     * It used to read: "These are **channels**, not a 'who is live right now' board
     * — we do not detect liveness, so there is no live badge." Together with the
     * header comment of `routes/Live.tsx` that sentence was *the only reason this
     * page could stay honest*: as long as it stood, nobody expected the page to
     * tell them who is live.
     *
     * Item 10 asks for exactly that badge (plus viewer counts and a search box), so
     * the old sentence stopped being true. The fix is **not** to delete it (then the
     * page says nothing about what it is) but to replace it with something that is
     * still true: it is still a list of channels, but **now something really does
     * check them**.
     *
     * Two things must be said, and leaving either out is a new lie:
     *   ① **it lags**: the job runs every 3 minutes, and the response carries
     *      `max-age=60` + `stale-while-revalidate=300`, so a badge or a viewer count
     *      can be up to **9 minutes** old (the arithmetic lives in `routes/live.ts`).
     *   ② **only two platforms are checked** — Twitch and Bilibili. A YouTube row
     *      will never get a badge, and in the UI "not checked" looks exactly like
     *      "not live" (both render nothing), so the sentence has to name the
     *      platforms. (Why YouTube is out this round: `search.list?eventType=live`
     *      has its own 100-calls-per-day bucket — see the job's header, section 3.)
     *
     * NOTE: the Chinese side carries the same two facts; placeholders/keys must
     * stay aligned (`i18n-keys.test.ts` enforces the key and placeholder parity).
     */
    recordsChannels:
      'These are **channels**, not a real-time board — the "Live" badge and viewer counts are checked every few minutes for Twitch and Bilibili only, so they can lag behind.',
    relationToVideos:
      'How this differs from the "Videos" section: that one is whatever anyone posted (constantly changing), this one is a slow-moving curated list.',

    /*
     * ★ The "live now" badge (user item 10). It means "was live **the last time we
     *   checked**" — the lag is what `recordsChannels` above owns up to. Rendered
     *   only when `isLive === true`: `null` (never checked / could not check) and
     *   `false` (checked, not live) both render nothing, and they stay distinct in
     *   the data (`packages/shared/src/live.ts`).
     */
    liveBadge: 'Live',
    /*
     * Viewer count. ⚠️ Rendered **only when `viewerCount` is not `null`** — when the
     * upstream did not give a number, that cell renders nothing at all (no 0, no
     * "unknown"). That is why this section has **no** "viewers unknown" sibling key:
     * it would be a dead key with no render site.
     */
    viewers: '{{n}} watching',
    /*
     * The search box's visible name (placeholder) and its screen-reader label share
     * this one key — same shape as `ranked.liveSearch`. Both sites must stay in
     * sync: with a placeholder only, the input loses its name as soon as the user
     * types the first character.
     */
    searchLabel: 'Search name or tag',
    /*
     * "No match" gets its **own** sentence: the list is not empty then, it is only
     * filtered. Collapsing the two would read as "this page is empty" (the same
     * accounting the tracked-creators block did).
     */
    searchEmpty: 'No channels match.',

    // NOTE: `gotoChannel` is also the label for the channel-stable link we now
    // prefer on YouTube (youtube.com/@handle/live — measured: it resolves to the
    // current broadcast, and falls back to the channel page when nothing is on).
    gotoChannel: 'Open the channel',

    /*
     * Three different reasons for "no embed", and they must stay separate.
     *
     * ⚠️ Collapsing them into one "embedding is not supported here" turns the
     *    third case into a **switch that silently does nothing**: the editor
     *    clearly turned channel embedding on and sees nothing, so they conclude
     *    the page is broken — when the real cause is that the handle is not a
     *    `UC...` channel id.
     *
     * ⚠️ `noEmbedPlatform` used to read "unverified" — that was **false**: all
     *    three platforms have been tested, and "could not reach it from this
     *    machine" is not "untested" (Twitch resolved once tested via Hong Kong).
     *    It now serves the **generic** case, `'no_origin'`: without an `origin`,
     *    `liveEmbedDecision()` cannot build Twitch's `parent`, so "cannot embed
     *    here" holds while "the platform forbids it" does not.
     *
     * ★ Bilibili therefore gets its **own** string (`noEmbedBilibili`). The key
     *   name stays and only the value changes so that `LiveCard`'s exhaustive map
     *   and the `liverender` assertion keep working.
     *
     * ⚠️⚠️ **On 2026-09-13 this string's meaning changed and so did its value.**
     *    It used to read "Bilibili does not allow its live rooms to be embedded" —
     *    **that is now false.** Measured: the room page `live.bilibili.com/<room>`
     *    really does send `x-frame-options: SAMEORIGIN`, but Bilibili also ships an
     *    official *activity player* meant for embedding on other sites
     *    (`www.bilibili.com/blackboard/live/live-activity-player.html?cid=<room>`,
     *    documented at `live.bilibili.com/p/html/bilibili-live-player/docs/player-activity.html`),
     *    and it sends no frame restriction at all. So "Bilibili cannot be embedded"
     *    was **us using the wrong URL**, not a platform rule.
     *
     * ⇒ `liveEmbedDecision()` now embeds Bilibili whenever the handle is a plain
     *   room number, and only falls back here when we cannot read a room number
     *   (e.g. a `live.bilibili.com/blanc/xxxx` link). The wording therefore
     *   describes the shape *we* can handle rather than inventing a rule for
     *   Bilibili.
     */
    noEmbedPlatform: 'This platform cannot be embedded here. Open the original site instead.',
    noEmbedBilibili:
      'This Bilibili link has no room number we can read, so it can only open on the original site.',
    noEmbedNoId: 'This row has no live video id recorded, so there is no player.',
    noEmbedNotChannelId:
      'Channel embedding is on for this row, but the handle is not a UC… channel id, so it cannot embed (that mode only accepts those).',

    empty: 'No channels recorded yet',
    emptyHint: 'This list is kept by the content editors and changes slowly.',
    loadFailed: 'Failed to load. Please try again later.',
  },
  /**
   * ④=B "My live links" — the signed-in user's **own** links.
   *
   * A separate section rather than folded into `live`: that one is read by
   * **visitors** (the public list), this one by the user managing their own
   * private links. One difference is decisive — every row here is visible to
   * **that user alone**, so the copy must never say things like "it will show
   * up in the list right away" or "submitted for review": those are **false**
   * under the personal model. (That whole 15-string `liveSubmit.*` group was
   * retired with ④=B. Do not revive it.)
   */
  myLive: {
    title: 'My links',
    /*
     * ★ Privacy line — always shown, signed in or not. Mirrors the Chinese one
     *   three claims at a time, and all three are load-bearing:
     *   ① it is yours alone; ② **other signed-in users cannot see it either**
     *   (saying "visitors cannot" is not enough — "can someone else see this
     *   once they log in" is exactly the worry being answered); ③ it never
     *   enters the public channel list (that is a separate, editor-maintained
     *   thing users reasonably assume their paste might join).
     *
     * ⚠️ This is a statement about **existing** behaviour, not a plan. The
     *    evidence is in `services/api/src/live.ts` and `routes/live.ts`: every
     *    query is scoped by `user_id`, all four endpoints require auth, there is
     *    no `GET /live/mine/:id` at all, cross-user access 404s, and the
     *    responses are `no-store`.
     */
    privacy:
      'This list is private to your account. Nobody else can see it — not even other signed-in users — and it never appears in the public channel list.',
    addHint: 'Just paste the link to the channel page.',
    addAction: 'Add',
    saveAction: 'Save',
    deleteAction: 'Delete',
    /*
     * "Edit" — the inline-edit affordance (t37: `updateMyLiveLink` had no caller).
     *
     * ⚠️ Deliberately different from `saveAction`: that one is the submit button
     *    **inside** the form, this one **expands** the row into a form. Both can be
     *    on screen at once, so sharing a word would leave users unsure which to press.
     */
    editAction: 'Edit',
    deleteConfirm: 'Delete this one?',
    empty: 'Nothing added yet. Links you add here are visible only to you.',
    needLogin:
      'Sign in to save your own live channel links here — this list is for your eyes only.',
    gotoLogin: 'Sign in',
    /*
     * Three possible outcomes for a link, and they must stay separate.
     * Getting one wrong sends the user to click something they should not —
     * or makes them think the page is broken.
     */
    embedOk: 'This one plays right here.',
    linkOnly:
      'We cannot tell which platform this link belongs to, so the original site is all we can offer.',
    notSupported: 'This platform cannot be played in-page. Open the original site instead.',
  },
  /**
   * The **editing** UI for the live list (editors and above only).
   *
   * A separate section rather than folded into `live`: that one is read by
   * visitors (who is streaming), this one by editors (maintaining the list).
   * Mixing them makes "one sentence for a visitor" fight with "one sentence for
   * an editor".
   */
  liveManage: {
    title: 'Manage the live list',
    subtitle:
      'Only content editors see this interface. Visitors get the public version, without hidden rows.',
    addTitle: 'Add a channel',
    editTitle: 'Edit this row',
    addAction: 'Add',
    saveAction: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    close: 'Close',

    // ---- Fields ----
    /*
     * ★ The first field, and the only address field (finalised with the user
     *   2026-09-13). It replaces three fields: Platform (a select), Channel
     *   handle, and Current live video id. Their words: "drop the channel handle
     *   entirely" and "no need to pick the platform either, it can be derived
     *   from the link". Platform, handle and video id are all parsed server-side.
     */
    fieldUrl: 'Live link',
    fieldName: 'Display name',
    /*
     * Tags (2026-09-13). A **human label**, not load-bearing: the channel
     * handle — which decides links and embeds — now comes from the live link,
     * so it is no longer something anyone types.
     */
    fieldTags: 'Tags',
    fieldNote: 'One-line note',
    fieldEmbedChannel: 'Embed by channel',
    fieldSortOrder: 'Order',
    /** Title of the collapsed advanced block (order + channel embed). */
    advanced: 'Advanced',

    /*
     * ⚠️ This hint has to carry "both kinds of link work, and we derive the
     *    platform" — the user went three rounds on exactly this confusion.
     *
     * ★★ Changed again on 2026-09-14, because measuring is what finally made the
     *    difference clear (.cache/probe-live-links4.mjs, reading each page's own
     *    canonical URL):
     *      · a **channel** link (YouTube: `…/@handle/live`) gives a 「Open the
     *        channel」 button that **never goes stale** — live, it resolves to the
     *        current broadcast; offline, it falls back to the channel page.
     *        The cost: YouTube's channel-level *embed* only accepts a UC… channel
     *        id, so a row pasted as `@handle/live` gets **no player**.
     *      · a **single stream** link (`watch?v=…`) gets a player, but that link
     *        is dead as soon as the stream ends — which is the defect the user hit.
     *    ⇒ "both work" is not enough; the hint has to say what each one buys.
     */
    hintUrl:
      'Paste either a **channel** link or a link to **the stream on air now**. A channel link gives a 「Open the channel」 button that never goes stale (on YouTube that is a `…/@handle/live` URL); a single-stream link gives you a player, but you have to update it every stream. To get both, paste the channel link and have someone add the channel id.',
    placeholderUrl: 'https://www.youtube.com/@handle/live',
    hintName: 'The human-readable name; spaces are fine.',
    /* One comma-separated line, not a chip editor — that would need its own keyboard model. */
    hintTags: 'Optional, comma-separated, up to 12. e.g. speedrun, Ranked, highlights',
    hintNote: 'Optional. One line on what they stream — it is what visitors judge the link by.',
    /*
     * ⚠️ Carries three facts at once: YouTube only, `UC…` ids only, and
     *    experimental. Drop any one and an editor turns on a switch that does
     *    nothing.
     * ★ 2026-09-14: it is no longer "something today's rows do not need" — paste
     *    a `/channel/UC…/live` link and this switch is what makes the player
     *    follow the channel instead of staying pinned to one broadcast.
     */
    hintEmbedChannel:
      'Experimental, off by default. It can only work for YouTube rows whose channel handle is a UC… channel id (pasting a `/channel/UC…/live` link produces one); with it on, the player follows the channel rather than one pinned broadcast. When it does not work the player area is a black box that looks like our bug.',
    hintSortOrder: 'Lower numbers come first.',

    // ---- Row actions ----
    hiddenBadge: 'Hidden',
    hide: 'Hide',
    show: 'Show',
    delete: 'Delete',
    confirmDelete: 'Deleting cannot be undone. Are you sure?',
    confirmYes: 'Delete it',
    confirmNo: 'Keep it',

    // ---- Outcomes ----
    added: 'Added',
    saved: 'Saved',
    hidden: 'Hidden',
    shown: 'Shown',
    deleted: 'Deleted',
    /** ⚠️ A no-op is **success**, not an error (it was already in that state). */
    changedNothing: 'It was already in that state — nothing changed.',
    exists: 'That channel is already recorded',
    existsHint:
      'One row per platform + handle. The row marked below is it — edit that one instead of adding another.',

    /*
     * ⚠️ `needLogin` / `forbidden` / `gotoExisting` are **deliberately absent**:
     *    · needLogin / forbidden — this panel renders only when
     *      `useCan('live.manage')` is true, so anyone who can see it has the
     *      capability; those two sentences are unreachable by construction.
     *      An expired session is handled by `apiErrorText`'s 401 branch.
     *    · gotoExisting — `live_exists` is answered by **highlighting the row**,
     *      which is already on this page, so a "go there" link is redundant.
     */
    loadFailed: 'Failed to load. Please try again later.',

    /*
     * Field-level errors. `LiveChannelInputSchema` runs client-side first, so
     * these are **local** strings — the server's message is hard-coded Chinese
     * and showing it would put a Chinese sentence in the English UI.
     */
    errUrlRequired: 'A live link is required.',
    errUrlNotLink:
      'Paste the **full link** — a bare handle carries no platform, and we need the platform to build an address.',
    errUrlSpace: 'A link cannot contain spaces.',
    errNameRequired: 'A name is required.',
    errSortOrder: 'Order must be a whole number from 0 to 9999 (lower comes first).',
    errGeneric: 'A field did not pass validation — check the ones marked above.',
  },
  /**
   * ② Direct authoring — the content-editor path that bypasses the review queue.
   *
   * A separate namespace from `resources` / `calendar` / `videos` because the
   * reader is different: those sections are the words a **submitter** sees,
   * this one is what an **editor** sees when their change will go live at once.
   * Mixing them would blur the one distinction that matters most here:
   * a direct edit takes effect immediately, a submission does not.
   *
   * ⚠️ Every string that says "no review" must stay explicit. The whole risk of
   *    this feature is an editor believing they are submitting for review when
   *    they are actually publishing.
   */
  authoring: {
    directPublish: 'Publish directly (no review)',
    directSave: 'Save directly (no review)',
    directHint:
      'You are a content editor: this change goes live immediately (no review queue) and is recorded in the audit log.',
    published: 'Published — live now.',
    saved: 'Saved — the live version is updated.',
    /*
     * ⚠️ This one has to explain the *consequence*, not just refuse. The editor
     *    asked for a direct edit and got a 409; if we only say "there is a
     *    pending change", they will retry, or look for another way in, instead
     *    of doing the one thing that actually unblocks them.
     */
    alreadyPending:
      'There is a pending change on this entry. Reject or approve it first: otherwise your direct edit is silently rolled back the moment that change is approved.',
    deleteTitle: 'Delete this entry',
    deleteAction: 'Delete',
    deleteImpact:
      "Deleting also removes the version history; for library entries it removes everyone's saves, notes and ratings. This cannot be undone.",
    mustHideFirst: 'Take it offline first: deletion is irreversible, hiding is not.',
    deleted: 'Deleted.',
    deleteConfirmYes: 'Delete for good',
    deleteConfirmNo: 'Keep it',
  },
  /**
   * Live shares — a signed-in user puts a room code or a set of world seeds on a
   * shared board for 5 / 10 / 15 / 20 minutes; it disappears by itself, and the
   * author can take it down (and put it back) at any time.
   *
   * ---------------------------------------------------------------------------
   * ⚠️★ One boundary here has to stay true forever (spec §1.1)
   * ---------------------------------------------------------------------------
   * This is the **first section on the site whose contents a guest cannot see**:
   * both boards require a login (401 for guests) and none of it appears on any
   * public surface. So every string that points at the content
   * (`introLead` / `loginNeeded`) has to say "only signed-in users", rather than
   * something like "you came too late" that sounds like a public board — the
   * latter leaves a guest refreshing a page they can never see.
   * ⚠️ The intro page `/shares` itself is **public** (guests issue no requests
   *    there and it never auto-refreshes): its whole job is turning "walked into
   *    a wall" into "read one sentence" (spec ruling 6).
   *
   * ---------------------------------------------------------------------------
   * Nothing to do with `live.*`
   * ---------------------------------------------------------------------------
   * "Live" is an editor-maintained public list of streamers (slow, stable,
   * public); this one is what users themselves put up for minutes (fast,
   * short-lived, behind a login). That is why the English names differ on
   * purpose: Live vs Now sharing, Ranked seeds vs World seeds.
   *
   * ⚠️ The two limits (40 units for a room note / 100 for a seed note) are
   *    measured in **display width**, where one Han character counts as 2
   *    (`textWidth()`, spec §3.2.1) — so `errNoteTooLong` has to say so, or a
   *    user who typed 21 Han characters will think the limit is a lie.
   */
  shares: {
    // ---- Intro page (`/shares`, public) ----
    /*
     * ⚠️ These two sentences are the **only** thing a guest gets to read, so the
     *    first one has to carry both facts: the things here vanish by
     *    themselves, and the contents need a login. With only the first, a guest
     *    concludes they were too late instead of not signed in.
     */
    introLead:
      'Anything posted here disappears on its own within minutes. Only signed-in users can see what is inside.',
    introRoomsTitle: 'Private rooms',
    introRoomsDesc: 'Share a room code so other people can join you.',
    introSeedsTitle: 'World seeds',
    introSeedsDesc: 'Share a set of world seeds: overworld, nether, end, RNG.',
    /** `{{n}}` is the site-wide count (not "yours"); guests get the other string. */
    introCount: '{{n}} on the board',
    introGuestCount: 'Visible once you sign in',
    /*
     * ★★ The fourth sentence (2026-09-15, a gap in the plan, not in the code):
     *    the fetch failed.
     *
     * ⚠️ It has to say **not read**, so that a failure never looks like loading —
     *    "looks like loading" is exactly what the old shape did (a failed fetch
     *    left `summary` at `null`, the view rendered `common.loading`, and a
     *    signed-in user waited forever with no way to retry).
     */
    countFailed: 'Could not read the counts.',

    // ---- Board pages (both kinds, real URLs, switchable tabs) ----
    /*
     * ⚠️ Not "Seeds": the sidebar's ranked-seed section is already "Ranked
     *    seeds", and two Seeds rows would look like the same section twice.
     */
    tabRoom: 'Private rooms',
    tabSeed: 'World seeds',
    /** The boards are the part a guest cannot see, so each page needs a way back. */
    backToIntro: '← What this section is',
    loginNeeded:
      'Sign in to see what people are sharing here — it is visible only between signed-in users.',
    needVerify: 'You need to confirm your email before you can post anything.',
    resendVerify: 'Send a new confirmation email',
    verifySent: 'Confirmation email sent — go and check your inbox.',

    // ---- "Your one entry" ----
    mineNone: 'You are not sharing anything right now.',
    mineHidden: 'You took this one down.',
    mineCount: 'You are showing {{n}} / {{max}}',
    mineActive: 'You are showing this one.',

    // ---- Post form ----
    formRoomCode: 'Room code',
    /*
     * ⚠️ This one and `errCodeShape` do **not** copy spec §8's backticks around
     *    `-` and `_`: those backticks are the **document's markdown syntax** for
     *    marking literal characters, and nothing in the UI renders markdown — so
     *    copying them would put a pair of backticks on screen. The server-side
     *    wording for the same rule reads the same way: "a room code can only use
     *    letters, digits, - and _".
     */
    formRoomCodeHint: 'Letters, digits, - and _, 3–20 characters.',
    /*
     * ⚠️ The four buttons are worded differently **on purpose** (spec §7.3):
     *    a second room post **replaces** ("Swap it"), a second seed post adds
     *    ("Add another"). One shared string would let a room user believe they
     *    now have two entries when the first one is already gone — and a
     *    replaced entry cannot come back.
     */
    formOpenRoom: 'Post one',
    formOpenRoomAgain: 'Swap it',
    formOpenSeed: 'Post one',
    formOpenSeedAgain: 'Add another',
    formOverworld: 'Overworld seed',
    formNether: 'Nether seed',
    formEnd: 'End seed',
    formRng: 'RNG seed',
    formSeedOptional: 'Only the overworld seed is required — leave the rest blank.',
    formNote: 'Note (optional)',
    formNoteHint:
      'One line saying what this run is. A room is just a code; this is the line people read to decide whether to join.',
    formMinutes: 'Show it for',
    minutes: '{{n}} minutes',
    /*
     * ★ Seeds are entered in **days** (2026-09-16, the user's request: "in days,
     *   30 at most, type it yourself"), so this is a **second** string rather
     *   than a reuse of `formMinutes`: those four radios say "pick one", this
     *   one says "type a number", and the units differ (minutes vs days).
     *   One shared string means editing either side silently edits the other.
     * ⚠️ The "it disappears on its own" half is the most counter-intuitive
     *   property here (people expect a post to stay), and this is the only place
     *   on the seed form that can say it.
     */
    formDays: 'Show it for how many days',
    formDaysHint: '1–30 days, type it yourself. It disappears on its own after that.',
    formSubmitRoom: 'Post to the board',
    /*
     * ⚠️ With something already on the board, the room submit button **must**
     *    become this string (spec §7.3): the entry it replaces never comes back,
     *    and the button is the only place that says so. Taking an entry down is
     *    reversible and needs no confirmation; replacing is not.
     */
    formReplaceRoom: 'Post to the board (replaces the one you are showing)',
    formSubmitSeed: 'Add to the board',
    formSubmitting: 'Posting…',

    // ---- The board ----
    boardTitle: 'On the board',
    boardEmpty: 'Nobody is sharing right now.',
    boardYou: 'You',
    boardBy: '{{name}}',
    remainMinutes: '{{n}} minutes left',
    /*
     * ★★ These two tiers arrived on 2026-09-16, when seeds went from "20 minutes
     *   at most" to "30 days at most": with minutes as the only tier, a seed with
     *   29 days to go would read "41760 minutes left".
     * ⚠️ Which tier applies and where the boundaries sit is **not** decided here
     *   — the single implementation is `remainText` in `lib/shareTime.ts` (that
     *   file has the table and the reasoning for the boundaries).
     */
    remainHours: '{{n}} hours left',
    remainDays: '{{n}} days left',
    /**
     * ★ That a row vanishes **at the very second it expires** is the local
     *   ticker's job, so with minute granularity "0 minutes left" never appears.
     */
    remainUnderOne: 'Less than a minute left',
    /*
     * ★ The copy button is for the **reader** (they paste someone else's room
     *   code into the game), not just for the author — so every row has one, and
     *   `copyFailed` has to be visible: `navigator.clipboard` rejects outside
     *   HTTPS or without permission, and failing silently means the button might
     *   as well not exist.
     */
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy — select it by hand.',
    hide: 'Take down',
    restore: 'Restore',
    /*
     * ★★ "Delete permanently" is the only action in this section that needs a
     *   **second confirmation** (2026-09-16, the user's request: "after taking it
     *   down, the owner may delete it (delete for good)").
     * Why two clicks here and one there: taking an entry down is reversible (the
     *   `hideHint` sentence right below is exactly that promise), while deleting
     *   leaves **no row at all** — the server removes it from the database, and
     *   there is no recycle bin.
     * ⚠️ The two strings are **two clicks**, not two ways of saying the same
     *   thing: `deleteShare` is step one and only flips the row into its
     *   confirming state (**it sends no request**); `deleteConfirm` is step two
     *   and really deletes it.
     * ⚠️ Step two has to make "this is the end of it" visible, which is why it
     *   carries "Confirm" rather than repeating step one word for word — two
     *   identical labels leave the user unable to tell which click they are on.
     * ⚠️ Cancel reuses the site-wide `common.cancel` instead of a new string:
     *   one action, one word, everywhere.
     */
    deleteShare: 'Delete permanently',
    deleteConfirm: 'Confirm delete',
    /*
     * ★ This string contains `**expires**` — a real emphasis pair — so its render
     *   site must go through `em()`, and the key is registered in
     *   `services/api/src/i18n-keys.test.ts`'s `EXPECTED_SITES` (the call site is
     *   `em(t('shares.hideHint'))` in `ShareCard.tsx`).
     * ⚠️ It moved once: while the key existed but the component rendering it did
     *   not, it sat in `UNWIRED_KEYS`; the component landed and it was registered
     *   under its real shape in `EXPECTED_SITES` (that other table is empty now).
     * ⚠️ The sentence has to state where the reversibility **ends**: taking it
     *   down is undoable, expiring is not. "You can restore it" alone would make
     *   people expect an expired entry to come back.
     */
    hideHint:
      'Taking it down clears it off the board and you can restore it any time. Once it **expires**, you cannot.',
    atLimitSeeds: 'You are showing {{max}} already — take some down before adding more.',
    /*
     * ⚠️ This refusal has to name the next step: restoring a room is refused
     *   rather than silently displacing the entry currently up (spec §4.3 —
     *   displacing is "something disappeared that you never pressed anything
     *   for"), so it must say which one to take down first.
     */
    atLimitRestore:
      'You are already showing another one — take that one down first, then restore this one.',
    /*
     * ⚠️ A failed refresh **keeps** the old list (spec §7.5 row 4), so this
     *   string says "what you see is the old data" and carries the number that
     *   makes it meaningful; `{{secs}}` is recomputed every second locally.
     */
    refreshFailed: 'The last refresh failed — what you see is {{secs}} seconds old.',
    /*
     * ★ A wording that does **not** depend on the number.
     *
     * ⚠️ The previous value was `'Updated {{secs}} seconds ago'`, which printed
     *    "Updated 1 seconds ago" every time the count hit 1. That line had **no
     *    render site** until this round, so the defect was never visible; now it
     *    is on screen once per second.
     * ⚠️ Deliberately **not** an i18next `_one` / `_other` pair: this repo has no
     *    plural precedent (`resultCount: '{{count}} entries'` is a single key),
     *    and introducing one here would add two key pairs to both dictionaries
     *    that the Chinese side does not need.
     */
    updatedAgo: 'Updated {{secs}}s ago',
    loadFailed: 'Could not load the board.',
    /** ⚠️ The board stops at 200 rows and **says so** instead of truncating quietly. */
    truncated: 'Only part of the board is shown.',

    // ---- Form validation (the client maps these; they are not server text) ----
    errCodeShape: 'A room code can only use letters, digits, - and _.',
    errCodeLength: 'A room code has to be 3–20 characters.',
    errSeedRequired: 'The overworld seed is required.',
    errSeedLength: 'A seed can be at most 32 characters.',
    errSeedSpace: 'A seed cannot contain spaces.',
    /*
     * ★ The days field's error (2026-09-16). The check lives in `ShareForm`
     *   (`^\d{1,2}$` plus 1–30) and mirrors shared's `daysSchema` line for line,
     *   which is why this sentence has to say **both** "whole number" and the
     *   range: whoever typed `7.5` and whoever typed `31` each need to know what
     *   to do next, and one sentence has to serve both.
     * ⚠️ It sits with `errSeedSpace` / `errCodeLength` and is the same kind of
     *   copy: a **client-side** per-field hint, not server 400 text.
     */
    errDays: 'Days has to be a whole number from 1 to 30.',
    errNoteTooLong: 'That note is too long (at most {{max}} units; a wide character counts as 2).',

    /*
     * ★★ Three "why this cannot be done" strings (2026-09-15, frozen list §8).
     *
     * ⚠️ They fill a **real gap**: the server's `invalid_state` carries one of
     *    three reasons (`expired` / `not_active` / `not_hidden`) and the frozen
     *    list had **no strings for them**, so Task 5 — which was not allowed to
     *    add copy — mapped them onto status sentences (`mineNone` / `mineHidden`
     *    / `mineActive`). Those sentences are grammatical but **false**: someone
     *    with other entries still up who clicks a just-expired row is told
     *    "You are not sharing anything right now."
     * ⚠️ Do not treat them as unreachable (spec §8 corrected that once already):
     *    what keeps an expired row on screen is the gap between a response and
     *    the next one-second tick, plus background-tab timer throttling — a tab
     *    left in the background comes back with a row of long-expired entries.
     *    ⇒ These three **do** get read.
     * ⚠️ They are deliberately plain: they are only reachable in that window,
     *    but they must not be **untrue** — this repo's stance is that "why it
     *    failed" gets its own sentence instead of the nearest one.
     */
    errExpired: 'This one has expired — it cannot be changed any more.',
    errNotActive: 'This one is not on the board right now.',
    errNotHidden: 'This one was never taken down.',
  },

  /*
   * ===========================================================================
   * "Ranked now" (`/ranked`) — the frozen list from spec §7 (7.1 / 7.2 / 7.3)
   * ===========================================================================
   * ⚠️★ This block lands together with Task 5's four views (a 2026-09-16 plan
   *    change): those views carry 43 literal `t('ranked.x')` call sites, and
   *    `services/api/src/i18n-keys.test.ts` scans source for literal call sites
   *    and asserts the key exists in **this** dictionary -- so landing the views
   *    first leaves `pnpm -w check` red between Task 5 and Task 7, the exact
   *    shape this plan legislates against (the same mistake had just shown up
   *    on Task 3's error-code contract).
   * ⚠️ No value may be empty or `TBD`, and this side must hold **zero CJK**
   *    characters (a render-script scan enforces it).
   * ⚠️ Nothing outside this section moves: it is appended whole, after `shares`.
   */
  ranked: {
    // ---- The four tabs (`RankedTabBar`, spec §7.1) ----
    /*
     * ⚠️★ These four live **only** inside a `Record<RankedTab, string>`
     *    (`RANKED_TAB_LABEL_KEYS`) and are rendered by
     *    `t(RANKED_TAB_LABEL_KEYS[each])` -- the source holds **no** literal
     *    `t('ranked.tabStatus')` call site, so `i18n-keys.test.ts`'s "every
     *    literal key must exist" guard **cannot see them** (it scans literal
     *    call sites; a table value is a value, not a call).
     *    A 2026-09-16 review measured exactly that: none of the four existed in
     *    either dictionary, so all four tabs printed `ranked.tabStatus` ... in
     *    both languages while every gate stayed green.
     * ⚠️ The English values are spec §7.1's **frozen** column: `tabLive` must
     *    **not** read "Live" -- the sidebar's 直播 section already owns "Live"
     *    (this repo already spent a round on two Lives in one sidebar);
     *    "Top matches" is safe inside a tab strip.
     */
    tabStatus: 'Status',
    tabLive: 'Top matches',
    tabElo: 'Leaderboard',
    tabWeekly: 'Weekly race',

    // ---- (1) Status and player count (`RankedStatusView`, spec §6.2) ----
    /*
     * ★ The region heading for panel (1) (added after the 2026-09-16 review):
     *    (2)(3)(4) each open with `<h2 className="ranked__title">` while (1)
     *    started straight at a badge -- a screen reader jumping by heading
     *    **skipped** the first thing this page has to say.
     * ⚠️ It is a **separate** key from `tabStatus` ("Status"): that word answers
     *    "where does this take me", this one answers "what is this block".
     *    Folding them together means editing one silently edits the other.
     */
    statusTitle: 'Service status',
    statusUp: 'Up',
    /*
     * ⚠️ Four states, four sentences (`STATUS_KEYS` is an exhaustive
     *    `Record<0|1|2|3, string>`): folding "pending" and "maintenance" into
     *    "down" sends people hunting for a problem of their own inside a
     *    **planned** maintenance window.
     * ⚠️★ Since 2026-09-19 the four sentences are used by **four rows** (the
     *    status bar is no longer a single Game Server heartbeat).
     */
    statusDown: 'Down',
    statusPending: 'Pending',
    statusMaintenance: 'Maintenance',
    /*
     * ★★ The **four components** of the status bar (the user's own words:
     *    "Game Server, API, Store and Wiki, each with its state and last
     *    update time").
     * ⚠️★ These names are **in no API**: the heartbeat body is keyed by bare
     *    ids (`"2"/"3"/"4"/"5"`) and the names exist only inside the human
     *    status page's inline `window.preloadData` script -- whose three
     *    `/api/status-page/…` siblings all 403. So this mapping is the **one**
     *    part of this section that no API has verified (the full story lives
     *    on the table in `packages/shared/src/ranked/const.ts`).
     * ⚠️★ Since 2026-09-18 the **Chinese** side reads 「服务器」/「商店」 (the owner's own
     *    edit; `componentApi` / `componentWiki` were already Latin and did not change).
     *    So the two dictionaries **no longer carry the same values** — this paragraph used
     *    to say they did ("the upstream's proper nouns, not product copy to translate").
     *    ⚠️ The id ↔ name mapping now lives in the **key** (`RANKED_STATUS_COMPONENTS` in
     *    `packages/shared/src/ranked/const.ts`: ids 2/3/4/5 → these four keys), not in values.
     *    ⚠️ Cost: the four names were **copied off the status page**, and after the Chinese
     *    translation the one manual check that can catch a re-numbering by upstream
     *    (`pending.md §5.99` ①) has to compare **these English words** — the status page has
     *    no Chinese on it. These values are what makes that check still possible.
     */
    componentGameServer: 'Game Server',
    componentApi: 'API',
    componentStore: 'Store',
    componentWiki: 'Wiki',
    /*
     * ⚠️★ `{{time}}` is the upstream string (`2026-09-17 11:16:27`)
     *    **verbatim**, with **no** zone conversion: it carries no zone, so
     *    `new Date()` would read it in the machine's own zone -- the value
     *    would drift per server (this repo has been burned by a silent
     *    eight-hour offset) and the test would turn into a lottery. It answers
     *    "how fresh is **that heartbeat**", not "how old is what is on your
     *    screen" (the latter is the chrome's own `updatedAgo` line).
     * ⚠️ It replaces `statusCheckedAt` ("Last heartbeat {{time}}"), which was
     *    written for the single-row era; with four rows each one needs its own
     *    last update, and "last update" is the user's own word.
     */
    componentCheckedAt: 'Last update {{time}}',
    /*
     * ★★ The **section title** for the player-count block (user, 2026-09-19 round
     *    two: "drop the big 1119 and make it a big title「实时在线人数」, with the
     *    count written big, bold and Minecraft-green underneath").
     * ⚠️★ A different sentence from `players` right below: this one is a heading
     *    (what this block is about), that one is the **reading** (how many are
     *    playing now). Merging them deletes the heading -- which is the very
     *    thing that was asked for.
     * ⚠️ It sits in the same panel as `statusTitle`: the four service rows answer
     *    "are we up", this block answers "how many are playing", two facts with
     *    one heading each. Avoid the bare word "Live" (the sidebar already owns
     *    it -- the frozen §7.1 rule).
     */
    playersTitle: 'Players online right now',
    players: '{{n}} playing Ranked',
    /*
     * ⚠️★ A different sentence from `playersZero` ("Nobody is playing Ranked
     *    right now"): this one says "we could not read it", that one states a
     *    fact. Merging them makes "unreadable" look like a fact -- and that is
     *    exactly the thing we do not know.
     */
    playersUnknown: 'Player count is unavailable right now',
    playersZero: 'Nobody is playing Ranked right now',
    /*
     * ★★ The response's `stale: true` (added 2026-09-16): the **server** served a
     *    fallback (the upstream was unreadable at that moment, so it handed back
     *    the previous successful heartbeat) while **our own** refresh succeeded.
     *    That is not the same event as `refreshFailed` ("the last refresh
     *    failed"); merging them sends people to debug a network problem that
     *    never happened. ⚠️ Without this sentence, a fallback heartbeat is
     *    indistinguishable on screen from a fresh one.
     */
    statusStale: 'The server is serving a stale fallback copy of this data.',
    /*
     * ---- ★ Four keys **deleted** on 2026-09-19 (not an oversight) ----
     * `statusPing` ("Ping {{ms}} ms"), `statusPingUnknown` ("Ping unknown"),
     * `statusUptime` ("24h uptime {{pct}}%") and `statusCheckedAt` ("Last
     * heartbeat {{time}}") are gone from **both** dictionaries: the user's
     * ruling is that the status bar keeps only the four rows (state + last
     * update) and the online count, "no other information". Latency, uptime,
     * the heartbeat history and the single-row heartbeat line have no render
     * site any more. ⚠️ A key with no consumer costs something concrete: the
     * next reader assumes it still has a render site, and "why is the latency
     * not on screen" turns into a three-file question (this repo has deleted
     * `shares.moderateHideReason` for exactly that reason). The upstream still
     * sends `ping` / `uptimeList`; we do not read them (`parse.ts` says so).
     */

    // ---- (2) Live top matches (`RankedLiveView`, spec §6.3) ----
    /*
     * ⚠️★ The title names only what this panel actually selects: matches being played
     *    **right now**. It used to read "Top matches streaming right now" (changed
     *    2026-09-16), which overstated two things: a card may have **no stream at all** (the
     *    upstream field is empty; the render fixture's top card is even named `Nostream`) --
     *    streaming is carried by each card's own "Show streams (N)" -- and "top" is an
     *    **average** elo ordering in which an unrated player (`eloRate: null`) is normal
     *    (spec §10 item 6), so the leading card is not necessarily a high-elo one.
     *    The ordering itself is spelled out by `liveFrom` right below.
     *    ⚠️★ 2026-09-19 removed the "(top 10 by average elo)" parenthetical as well (the user
     *    asked for **every** match): from that day "top 10" is simply false (no truncation
     *    any more, see `RANKED_LIVE_BATCH`), and "by average elo" was already said by
     *    `liveFrom` -- a title and a line saying the same thing drift apart one edit at a time.
     */
    liveTitle: 'Matches playing right now',
    liveEmpty: 'There is no live match right now.',
    /*
     * ⚠️★ Rewritten 2026-09-19 (it used to be "Top 10 of {{total}} by average elo"): the list
     *    is no longer truncated (first batch + "Load more"), so "top 10" became false on the
     *    spot. It now says two things that are both true -- how many matches upstream sent,
     *    and what the order below is.
     *    ⚠️ `{{total}}` is the **upstream total** (`sliceLiveMatches().total`), not the
     *      filtered count: when a filter is on, `liveMatched` below says how many survived.
     *      The two must not impersonate each other (otherwise "23 matches" sits above five
     *      cards, and one of the two sentences is a lie).
     */
    liveFrom: '{{total}} matches, highest average elo first',
    /*
     * ★ The search box (`ranked.liveSearch`) and the toggle (`ranked.liveBothLive`) are the
     *    two controls the user asked for on 2026-09-19; these keys belong to this section
     *    (**not** reused from `resources.searchPlaceholder` -- that one means "search
     *    resources", and cross-section reuse means editing one section silently edits the
     *    other; this repo already ruled on that for the weekly-race seeds).
     * ⚠️ `liveSearch` is both the placeholder and the label (`<label class="sr-only">`): a
     *    placeholder disappears after the first keystroke, so a placeholder-only field has
     *    no name at all.
     */
    liveSearch: 'Search player',
    liveBothLive: 'Both streaming only',
    /*
     * ⚠️★ "Nothing survives the filter" is a **different sentence** from `liveEmpty`
     *    ("There is no live match right now"): this one says upstream *does* have matches and
     *    the current term/toggle filtered them all out. Swapping them tells the user upstream
     *    is empty, so he goes looking for a problem somewhere else -- when all he has to do is
     *    clear the box.
     */
    liveNoMatch: 'No match fits the filter.',
    /*
     * ⚠️ "{{matched}} fit the filter" is rendered only when the filter actually removed
     *    something (the predicate is "matched < total"): otherwise it repeats the total from
     *    `liveFrom`, which reads like a broken template.
     */
    liveMatched: '{{matched}} match the filter',
    /*
     * ★★ "Load more ({{n}} left)" -- `{{n}}` is **how many are still unrendered**
     *    (`remaining`), computed together with the list above (the reasoning lives on
     *    `sliceLiveMatches`). ⚠️ It must not be a second formula such as "matched - batch":
     *    once a filter is on, that prints a bigger number than is actually left, and clicking
     *    **adds nothing** (the user just concludes the button is broken).
     */
    liveMore: 'Load more ({{n}} left)',
    liveExpand: 'Show streams ({{n}})',
    /*
     * ⚠️★ The wording is "**this link** cannot be embedded", NOT "this platform is
     *    unsupported": `livePlatform === null` covers two cases -- an
     *    unrecognised platform (kick), and a platform that does support embedding
     *    but whose URL here has no embeddable video (`youtube.com/@handle`). For
     *    the second case "the platform is unsupported" is **false**, and people
     *    act on it.
     * ⚠️ There is no `liveCollapse` / `liveNoStream`: native `<details>` owns
     *    collapsing, and a match where neither player streams has **no** expand
     *    control at all -- this repo deletes keys that have no consumer
     *    (`shares.moderateHideReason` went the same way).
     */
    liveExternal: 'This link cannot be embedded — open it in a new window',
    /** The middle cell: how long **this match** has run (not either player's milestone). */
    matchTime: 'Running {{time}}',

    // ---- (3) Elo leaderboard (`RankedEloView`, spec §6.4) ----
    eloTitle: 'Elo leaderboard',
    season: 'Season {{n}}',
    /*
     * ⚠️ The season window's **seconds to milliseconds** conversion happens in the
     *    view (`new Date(sec * 1000)`): the upstream sends seconds, and a unit
     *    mix-up does not throw here -- it prints an absurd date.
     * ⚠️★ User, 2026-09-19 round two: "Season 12 2026/9/17 → 2026/12/30 -- **drop
     *    the start date**, make it 'Season 12, ends 2026/12/30, Phase 1, ends
     *    2026/9/30'". ⇒ `seasonRange` ("{{from}} → {{to}}") is **deleted** and
     *    replaced by this key: of the two dates, only the end is worth reading
     *    (it says how long the season still runs), while the start is a settled
     *    historical fact. ⚠️ `startsAt` is still **parsed** (it is part of the
     *    upstream shape); this change only stops it being **printed**.
     *    ⚠️ A key with no consumer may not stay behind: the render self-check
     *    pins its absence.
     */
    seasonEndsAt: 'Ends {{when}}',
    /*
     * ★★ "Phase" — the user asked (2026-09-19) that the leaderboard show the
     *    season window **and, side by side**, the phase information.
     * ⚠️★ These two sit in the **same row** as `season` / `seasonEndsAt`
     *    (`.ranked__meta` is a flex row with a gap): a phase is a division
     *    **inside** a season, and splitting them over two lines makes them look
     *    unrelated.
     * ⚠️ They come from a **separate endpoint** (`/phase-leaderboard`, 93 bytes
     *    measured) because `/leaderboard` carries no phase object at all. That
     *    second request is the whole cost of this cell.
     * ⚠️ `{{when}}` is rendered in the **local** time zone, exactly like the
     *    season end (the upstream sends **seconds**; the view multiplies).
     * ⚠️★ Round two (2026-09-19) reworded the **Chinese** side to 「结束时间
     *    {{when}}」 so that both dates (season, phase) read the same way; this
     *    English value is **unchanged** -- "Ends {{when}}" already said it, and
     *    adding "time" here would only make the row longer. The two languages
     *    are deliberately not word-for-word mirrors (the same call was made for
     *    the four component names).
     */
    phase: 'Phase {{n}}',
    phaseEndsAt: 'Ends {{when}}',
    /*
     * ⚠️★ This sentence is the **failure** cell and is not the same thing as
     *    "the upstream sent it but a field is empty" (that one prints `—`).
     *    The container fetches the phase on the auxiliary path (`fatal: false`),
     *    so the leaderboard still renders and does **not** grow a "could not
     *    load" line. ⚠️ This cell must not silently disappear: the user asked
     *    for it by name, and an absent cell looks exactly like "the upstream
     *    has none" -- the reader cannot tell whether to retry.
     */
    phaseUnknown: 'The phase information is unavailable right now',
    colRank: 'Rank',
    colNickname: 'Nickname',
    colElo: 'Elo',
    colHighest: 'Highest',
    colPhasePoint: 'Phase points',
    eloEmpty: 'Nobody is on the board this season yet.',

    /*
     * ===========================================================================
     * ★★ (3)'s search box and inline expansion (user, 2026-09-19: "clicking a row
     *    should show that player's recent matches and numbers", and "put a search
     *    box at the top so people can look up a player themselves")
     * ===========================================================================
     * ⚠️★ The search box has **two halves**, i.e. two different things (hence two
     *    groups of keys):
     *   · **typing** filters the **150 rows already in hand**, locally -- the
     *     upstream has **no** search/prefix endpoint at all (findings §7: the only
     *     way to look someone up is `/users/{identifier}`, and it is an **exact**
     *     match: `lowk3y` does not find `lowk3y_`);
     *   · **Enter / the button** looks up **one** exact player, straight to the
     *     upstream, spending the visitor's own quota.
     *    Folding them into one sentence would suggest that typing finds players off
     *    the board, and number 151 can never be reached that way.
     */
    searchLabel: 'Search players',
    searchPlaceholder: 'Enter a player nickname',
    searchSubmit: 'Look up',
    /*
     * ⚠️ This is the **manual for both halves** (it sits right under the box): the
     *    placeholder alone can only say "enter a player nickname", never that typing
     *    filters what we already have while Enter really goes and asks -- and those
     *    two have very different costs (one is local, the other spends quota and may
     *    come back with "no such player").
     */
    searchHint:
      'Typing filters the board already loaded; press Enter to look up one exact nickname.',
    /*
     * ★ The two "no" answers to a lookup. They render inside `.ranked__lookup` under
     *    the search box and they are **the answer to that one lookup**, with **no retry
     *    button** -- the upstream match is exact, so retrying gives the same answer
     *    forever (a completely different thing from the failure banner + retry at the
     *    top of the panel).
     * ⚠️★ The fix round (T4), 2026-09-19, deleted the near-duplicate pair that used to
     *    sit here as well (`ranked.errUserNotFound` / `errInvalidIdentifier`, in the
     *    `describeRankedError` family): they never had a production caller -- the
     *    container hands both of those two answers to *these* keys, not to the failure
     *    banner.
     *    ⚠️ One fact checked while deleting them, so nobody re-states the old wording:
     *    `errUserNotFound`'s **Chinese** value was byte-identical to `lookupNotFound`
     *    (both 「没有这个玩家。」); the difference was on the **English** side only.
     *    (`errInvalidIdentifier` vs `lookupInvalid` did differ on both sides: the former
     *    quoted the upstream's "longer than 20 characters" rule, this one does not.)
     * ⚠️ The wording that does matter is the **direction**: this one says "**this
     *    nickname** cannot be found right now", which is not `errNotFound`
     *    ("There is no such week.").
     */
    lookupNotFound: 'No player with that nickname.',
    lookupInvalid: 'That nickname is not valid (too long or malformed).',
    /*
     * ⚠️★ It is **not** the same sentence as `eloEmpty` ("Nobody is on the board this
     *    season yet."): this one says "the upstream has a board, your query filtered
     *    all of it away", that one says "the upstream is empty right now". Confusing
     *    them sends the reader looking for a problem elsewhere, when all they have to
     *    do is clear the box (the same pairing as `liveNoMatch` / `liveEmpty` in (2)).
     * ⚠️ `{{q}}` is the search text **after trimming** (that is what the filter uses).
     */
    eloFilterEmpty: 'No player matches "{{q}}".',

    /*
     * ---- The card that expands out of a row (`.ranked__detail`) ----
     * ⚠️★ Two places talk about elo and they must stay apart -- this is the most
     *    expensive red line in the whole section:
     *   · `detailElo` (this line) prints what the player is **now**
     *     (`RankedPlayerDetail.eloRate`);
     *   · each match's elo cell (`.ranked__detailelo`) prints **how much that match
     *     moved** (`changes[].change`) and deliberately has **no key** -- it is a
     *     number (`+12` / `-8`), not a sentence.
     *    Mixing them produces the "2349 at the time / 2342 after" contradiction that
     *    looks perfectly normal: findings §2.1 bottom proves across three real
     *    matches that `players[].eloRate` is the value **at request time**, not at
     *    match time, so the second one can only come from `eloChangeOf()`, and when it
     *    cannot be read the cell shows `—` (**never 0**).
     */
    detailElo: 'Elo {{elo}}',
    detailRank: 'Rank {{rank}}',
    /*
     * ⚠️ Both records carry `{{wins}}` / `{{loses}}`: all four numbers can be
     *    unreadable (every leaf of the upstream `statistics` block is
     *    `{ranked, casual}` and we take the `ranked` half only), and the caller fills
     *    the gap with `—`, **not 0** -- "0 wins 0 losses" is a true statement, "we
     *    could not read it" is a different one.
     */
    detailSeasonRecord: 'Season {{wins}}W {{loses}}L',
    detailTotalRecord: 'All-time {{wins}}W {{loses}}L',
    /** ⚠️ `{{time}}` is **milliseconds** (`season.bestTimeMs`); the caller runs `formatRaceTime`. */
    detailBestTime: 'Season best {{time}}',
    /*
     * ⚠️★ `{{n}}` is the length of **the array we hold**, not the `count` we asked
     *    for: `parseMatches` drops rows whose shape is broken (no identity), so using
     *    `count` would print "Last 10 matches" above eight rows -- a contradiction
     *    that no gate in this repo can see.
     */
    detailRecent: 'Last {{n}} matches',
    detailNoMatches: 'No recent matches.',
    /*
     * ⚠️★ This one says "we could **not read it this time**", which is a different
     *    sentence from `detailNoMatches` ("there are none") -- one is worth a retry,
     *    the other is a fact. ⚠️ The expansion state has no "no such player" picture
     *    of its own (`RankedDetailState` has three variants, a frozen contract), so an
     *    upstream "user is not exists" lands here too. The cost is written down: in
     *    the "this player renamed" case the sentence understates it (retrying will not
     *    change anything), and that case can today only be told by the lookup half
     *    (`lookupNotFound`).
     */
    detailFailed: 'Data for this player cannot be read right now.',
    /*
     * ★ The four outcomes of a match (`matchOutcome`: win / loss / draw / unreadable).
     * ⚠️ The fourth says "this row does not line up with this player" (`selfUuid` is
     *    not in `players[]`); it is **not** "loss" -- that would be a fact we do not
     *    have (the order of the predicates is written on `matchOutcome` in `select.ts`).
     * ⚠️ A draw (`result.uuid === null`, measured in 3 of 100 rows) is a **real draw**,
     *    not "unreadable".
     * ⚠️ `outcomeUnknown` shares its value with `unknown` (both `—`): the fourth
     *    variant is a placeholder in the UI, and we do not invent a sentence for it.
     */
    outcomeWin: 'Win',
    outcomeLoss: 'Loss',
    outcomeDraw: 'Draw',
    outcomeUnknown: '—',
    detailVod: 'VOD',
    /*
     * ★ `match.type` -> what kind of match this was (docs: 1 casual / 2 ranked /
     *   3 private / 4 event; **only 2 and 3 were ever measured**).
     * ⚠️★ Printing it is not decoration: for a private match (type 3) the upstream's
     *    `changes[]` is **always empty** (measured 32/32) and both `seed` fields are
     *    null, so that row shows `—` for the elo change and for the seed. Without this
     *    cell the reader takes "a private match has none of these" for "this panel
     *    failed to read them" and goes off to retry, which can never change the `—`.
     * ⚠️ If the upstream adds a fifth type, the table has no row for it: the view
     *    prints **that number** verbatim (exactly how `timelineLabel()` treats an
     *    unregistered identifier) -- it neither invents a sentence nor leaks a raw key.
     */
    matchTypeCasual: 'Casual',
    matchTypeRanked: 'Ranked',
    matchTypePrivate: 'Private',
    matchTypeEvent: 'Event',

    /*
     * ---- The "seeds" button on the right of every match row, and the panel
     *      it opens underneath it (2026-09-19, fourth round) ----
     *
     * ★ The user's words: "put a button on the right of every match; clicking it
     *   queries the seeds via the api and shows them below that match's
     *   information". The seeds come from a **separate service** (the ops box's
     *   `/api/v2/seed/{matchId}`, through our existing same-origin route
     *   `GET /api/ranked-seeds/match/:matchId`), which is **not** the same thing
     *   as `matchTypeEvent`'s row above (`seedType` / `bastionType`, structure
     *   codes): that one says which structure the match had, these three are the
     *   **world seed values**. Both end up under the same match, so the wording
     *   has to keep them apart.
     *
     * ⚠️★ `seedButton` is **button text**, not a heading: a screen can hold a
     *    dozen identical ones, and a screen reader reads them as "Seeds, button,
     *    collapsed" (the real `aria-expanded` sits on the button and comes from
     *    that match's own state).
     * ⚠️ The three labels **reuse the three above** (`seedOverworld` /
     *    `seedNether` / `seedEnd`, the same group the weekly race uses): the same
     *    thing has no reason to be worded twice inside one section, and three
     *    more keys with identical values would be two sources of truth that drift
     *    (this repo has deleted duplicate keys for exactly that). Only the
     *    **count** differs: the weekly race has four (including RNG), here there
     *    are the three the upstream gives.
     */
    seedButton: 'Seeds',
    /*
     * ★★ This sentence describes the **normal** case: the seed library only
     *    covers about 80% of matches (the ledger and the 404 in
     *    `routes/seeds.ts` both say so), so it is **not** a failure and must not
     *    sound like one worth retrying.
     * ⚠️★ It and `seedUnavailable` below **must be two different sentences**:
     *    one is "this one is not in the library" (retrying changes nothing), the
     *    other is "we could not read it this time" (worth one more click).
     *    Merging them either sends the user clicking forever on an id that can
     *    never be found, or turns a network blip into "this match will never have
     *    seeds".
     */
    seedNotFound: 'The seeds for this match are not in the library.',
    /** ⚠️ Paired with the sentence above (one permanent, one retryable) -- see that block. */
    seedUnavailable: 'Seeds cannot be read right now.',

    // ---- (4) Weekly race (`RankedWeeklyView`, spec §6.5) ----
    weeklyTitle: 'Weekly race',
    weeklyNumber: 'Week {{n}}',
    weeklyEndsAt: 'Ends {{when}}',
    weeklySeed: 'Seed',
    /*
     * ★★ The four seed labels are **this section's own** four (added 2026-09-16).
     * ⚠️★ They do not reuse the shares section's `shares.formOverworld` group:
     *    cross-section reuse means editing one section's copy silently edits the
     *    other, and those four belong to "I am sharing a seed set" while these
     *    four say "this week's race was drawn from these".
     *    ⚠️ They sit alongside `weeklySeed` ("Seed"), which names the group.
     *    ⚠️★ The 2026-09-16 review measured that `weeklySeed` had **no consumer**
     *      at all back then (a frozen key with no rendering site would have been
     *      deleted under this repo's "no consumer, no key" rule); the ruling was
     *      to give it one -- it is now the caption line
     *      (`<p class="ranked__meta">`) sitting directly above `<dl class="ranked__seeds">`.
     */
    seedOverworld: 'Overworld',
    seedNether: 'Nether',
    seedEnd: 'The End',
    seedRng: 'RNG',
    weeklyPrev: 'Previous week',
    weeklyNext: 'Next week',
    /*
     * ★★ The two things the user asked for on 2026-09-19: let them type a week
     *    number and jump straight to it, plus a "this week" button (and move
     *    previous/next **to the top**).
     * ⚠️ `weeklyJump` is both the placeholder and the label
     *    (`<label class="sr-only">`): a placeholder disappears after the first
     *    keystroke, so a placeholder-only control has no name (same reasoning as
     *    `liveSearch`).
     * ⚠️ `weeklyThisWeek` is a **real link**, not a button: it points at the
     *    newest week (`/ranked/weekly/103` once `latestId` is known, the
     *    id-less `/ranked/weekly` before that) -- both are URLs you can refresh
     *    and share.
     * ⚠️★ `weeklyBadNumber` covers **only** "that is not a week number" (empty
     *    box, letters, decimals, full-width digits). "That week does not exist"
     *    (0 / ≤ -2 / newer than the newest week) deliberately reuses
     *    `errNotFound` ("There is no such week.") -- that is the very sentence
     *    the upstream answers a non-existent week id with, and locally deciding
     *    the same thing has no reason to word it differently (the table lives on
     *    `WEEK_INPUT_ERROR_KEYS`).
     */
    weeklyJump: 'Jump to week',
    weeklyJumpGo: 'Go',
    weeklyThisWeek: 'This week',
    weeklyBadNumber: 'Enter a week number.',
    colTime: 'Time',
    colEloRank: 'Elo rank',
    weeklyEmpty: 'Nobody has finished this week yet.',

    // ---- The chrome all four panels share, and the failure copy (spec §6.6) ----
    /*
     * ⚠️ Rendered only once a load has succeeded: "Updated 0s ago" would be a lie
     *    (there was no "last time"), and answering "how old is this data" is the
     *    only job this line has.
     * ⚠️ Worded so it never prints "1 seconds ago" (same handling as
     *    `shares.updatedAgo`).
     */
    updatedAgo: 'Updated {{secs}}s ago',
    /*
     * ⚠️ A failed refresh **keeps** the old data (spec §6.6 row 2), so this says
     *    "what you see is the old data" and carries the number that makes it
     *    meaningful; without the number, "the data may be stale" says nothing.
     * ⚠️ It is not `statusStale`: this one says "we failed to read it this time",
     *    that one says "we read it, and the server handed us a fallback".
     */
    refreshFailed: 'The last refresh failed — what you see is {{secs}} seconds old.',
    loadFailed: 'Could not load the data.',

    /*
     * ---- Failure to one sentence (`lib/rankedErrors.ts`'s seven cells) ----
     * ⚠️ Seven sentences because the reader's next step differs (wait for the
     *    upstream / wait for us / stop waiting): panels (2)(3)(4) talk to the
     *    upstream **directly from the visitor's browser**, so nothing about a
     *    failure reaches our logs -- the sentence on screen is all we ever learn.
     * ⚠️★ `errRateLimited` deliberately does **not** reuse the site-wide
     *    `rate_limited`: that one reads "we are rate limiting you", this one reads
     *    "the upstream is rate limiting you" (500 requests / 10 minutes per IP).
     */
    errBusy: 'The upstream is busy — try again in a moment.',
    errUnavailable: 'The upstream cannot be reached right now — try again later.',
    /*
     * ⚠️★ This used to read "..; we have noted it" (changed 2026-09-16). **We note nothing.**
     *    The direct path is visitor browser -> upstream, so our side never sees the failure
     *    (spec §10 item 8: the browser side deliberately does **not** log -- that was the
     *    decision in Task 1's review), and this sentence is everything the reader learns about
     *    what happened. Claiming an action we never take is worse than saying less: they may
     *    assume someone will look into it and stop reporting it.
     *    What is left is only what we actually know: the upstream sent something we cannot read.
     */
    errBadResponse: 'The upstream returned data we cannot read.',
    errNetwork:
      'Could not reach the upstream — a network issue or a browser extension may be blocking it.',
    /** ⚠️ `{{status}}` lives only in this one; with no number the caller uses its fallback. */
    errHttp: 'The upstream returned an error (HTTP {{status}}).',
    /** The upstream answers 400 for a week that does not exist: "no such week", not "unreadable". */
    errNotFound: 'There is no such week.',
    errRateLimited: 'That is a lot of requests — try again in a little while.',

    /*
     * ⚠️★ There used to be two more rows here -- `errUserNotFound` / `errInvalidIdentifier`
     * (added by T1, in the `describeRankedError` family). **Deleted by the fix round (T4),
     * 2026-09-19**: they never had a production caller ("no such player" / "invalid
     * nickname" is rendered by the `lookupNotFound` / `lookupInvalid` pair above), and
     * this repo's rule is that **a key with no consumer does not stay**.
     * Do not add them back without pointing at a call site that would reach them
     * (the reasoning lives under the seven-row table in
     * `apps/web/src/lib/rankedErrors.ts`).
     * ⚠️ One fact checked while deleting them, recorded so nobody re-states the old
     * wording: on the **Chinese** side `errUserNotFound` was byte-identical to
     * `lookupNotFound` (both 「没有这个玩家。」) -- only the English strings differed.
     */

    /*
     * ⚠️ The placeholder gets a key too (`eloRank` / `highest` / `phasePoint` /
     *    `timelineType` are all null sometimes): hard-coding `—` inside a component
     *    would mean the two languages can never be tuned apart.
     */
    unknown: '—',

    /*
     * ===========================================================================
     * Current milestone (`timeline.type`) — **key table + unknown fallback** (§7.2)
     * ===========================================================================
     * ⚠️★ **The values here are still the raw upstream identifiers, on purpose.** On
     *    2026-09-18 the owner turned the **Chinese** side into readable text
     *    (「进入堡垒遗迹」 …) and left this side alone, so the two locales no longer read
     *    alike: English shows `nether.find_bastion` where Chinese shows a phrase. Cost and
     *    what would close it (translating this side too — declined today) are in
     *    `docs/pending.md`.
     *    ⚠️ The key, **not the value**, is what maps an entry to upstream
     *    (`TIMELINE_LABEL_KEYS` in `packages/shared/src/ranked/timeline.ts`).
     *    ⚠️★ The old note here argued that writing anything else would fork away from
     *    `timelineLabel()`'s **unknown fallback** (which returns the identifier verbatim),
     *    so "the same identifier would render two different ways". That fork **now exists by
     *    design** on the Chinese side, and it is acceptable: the fallback still has something
     *    to say for a node the table has never seen, which is the whole reason that layer
     *    exists. Do **not** "fix" it by putting identifiers back into `zh-CN.ts`.
     * ⚠️ The row count matches `TIMELINE_LABEL_KEYS` **row for row** (9 today, including
     *    `story.root`, which spec §7.2's sketch never listed). Task 8's render check reads
     *    that table and asserts every row in both languages; a missing row leaks a raw key
     *    onto the page.
     */
    timeline: {
      root: 'story.root',
      enterTheNether: 'story.enter_the_nether',
      findFortress: 'nether.find_fortress',
      findBastion: 'nether.find_bastion',
      blindTravel: 'projectelo.timeline.blind_travel',
      followEnderEye: 'story.follow_ender_eye',
      enterTheEnd: 'story.enter_the_end',
      enterEndPortal: 'end.enter_end_portal',
      killDragon: 'end.kill_dragon',
    },
  },
  /**
   * "File updates" `/files` (2026-09-24) — the whole page's strings.
   *
   * ===========================================================================
   * ⚠️★ This section has to land with the page, and it serves a table that is
   * **the next task's** work
   * ===========================================================================
   * The table (`components/FileUpdateTable.tsx`) is Task 6 of the 2026-09-24 plan,
   * and **that task's file list does not include the dictionaries** (it only
   * touches `FileUpdateTable.tsx` / `FileUpdatesPanel.tsx` / `styles.css`) ⇒ every
   * word the table shows can only come from Task 5.
   * Cost: `colFile` / `colLocal` / `colAuto` … have **no render point** when Task 5
   * lands. The repo's "a key with no consumer does not stay" rule is read here as
   * "the consumer is the very next task, and that task cannot edit this file" —
   * so do not delete them on the "nobody uses it" instinct.
   * ⚠️★ **Final fix wave correction (present tense)**: the paragraph above describes
   *    the 2026-09-24 shape; today `components/FileUpdateTable.tsx` and
   *    `components/FileUpdatesPanel.tsx` are **both gone** (A's T6 removed them with
   *    the first section / D1, and `foldersrender.tsx` ㊵ pins that they are not in
   *    the tree). The surviving half (`VERDICT_BADGES` / `VERDICT_HINTS` /
   *    `RAW_KEY_RE` / `rawKeysIn` and that batch of shared predicates) lives in
   *    **`apps/web/src/components/ModFoldersData.tsx`** ⇒ every pointer below to
   *    those two deleted files reads as "where it lived back then"; **to change it
   *    today, go to `ModFoldersData.tsx`**.
   *
   * ===========================================================================
   * ⚠️★ Two places differ from the plan's table, neither of them a matter of taste
   * ===========================================================================
   * ① The plan's Chinese `autoHint` / `browserOnly` carry `**…**`, and both were dropped
   *    on the controller's ruling. ⚠️★ But the two reasons are **not** the same — do not
   *    merge them (corrected in review, 2026-09-24: this note used to claim both are
   *    "plain sentences rendered as-is", which is **wrong** for `browserOnly`):
   *      · `autoHint` renders inside a bare `<p>` (`.filespanel__hint` in
   *        `components/FileUpdatesPanel.tsx` back then; ⚠️★ that file was removed by
   *        A's T6 ⇒ this note is history **and** the reason `files.autoHint` has **no
   *        render point** today — it is one of the 45 dead keys in §5.112) and
   *        **never** goes through `em()` ⇒ keeping
   *        the marks would print two literal asterisks. That one really was broken.
   *      · `browserOnly` renders inside `<Notice>`, and `Notice` runs `em()` on **string**
   *        children (`components/Form.tsx`: `typeof children === 'string' ? em(children)`)
   *        ⇒ keeping the marks would **not** print asterisks (they would go bold), so
   *        dropping them here follows the carry-in (a value is plain text) — it was not
   *        fixing a defect.
   *    ⚠️ Folding the two together costs the next reader a wrong belief — that `<Notice>`
   *      does not handle markers either — and that is how someone ends up removing `em()`
   *      from a render point.
   *    📌 The `autoHint` case is the same disposition recorded on `calendar.seriesDeleteNone`.
   * ② The plan's table writes interpolation with **single braces**
   *    (`{count}` / `{time}` / `{reason}` …). i18next does **not** substitute
   *    single braces — it prints them. That is not style: a test guards it
   *    ("no single-brace interpolation in either dictionary" in
   *    `services/api/src/i18n-keys.test.ts`), and it really happened once.
   *    ⇒ All of them are `{{…}}` here. **Not one word of wording changed.**
   */
  files: {
    title: 'File updates',
    intro: 'Compare local files with the latest upstream versions, and update them when you click.',
    /*
     * ⚠️★ This is a **disclaimer**, not decoration: the checkbox is labelled
     *    "Auto", and it does **not** write anything (T1's `FileBinding.autoUpdate`
     *    only means "check on launch and highlight"). Without this sentence the
     *    user reads it as "it will change my mods folder by itself" — and that
     *    misunderstanding only surfaces after their files have been replaced.
     */
    autoHint:
      '"Auto" only means it checks on launch and highlights. Files are written only when you click.',
    colFile: 'File',
    colLocal: 'Local',
    colLatest: 'Latest',
    colAuto: 'Auto',
    /*
     * ★ Accessible name for the per-row "Auto" checkbox (`aria-label`, added by Task 6,
     *   2026-09-24).
     * ⚠️ Why the item name has to be in it: that column is one identical checkbox per row,
     *   so without it a screen reader reads a run of identical "Auto" labels — the same
     *   reason `nav.reorder` spells the section name into its label ("so the reader says
     *   'reorder the Resources section' instead of a row of identical 'reorder'").
     * ⚠️ Wording follows `autoHint` ("check on launch"); it must **not** say "update",
     *   because that checkbox never writes a file.
     */
    autoLabel: 'Check "{{name}}" on launch',
    colActions: 'Actions',
    bind: 'Choose file',
    rebind: 'Choose again',
    bindFolder: 'Choose mods folder',
    /*
     * ★ Not in the plan's table: **unbinding one item** (`unbind(itemId)` — the channel
     *   T3 built, the implementation T4 wrote).
     * ⚠️ Why it needs a consumer (Task 6's ruling; the full reasoning is on the button in
     *   `apps/web/src/components/FileUpdateTable.tsx`):
     *   ⚠️★ Final fix wave correction: that file and that button were **both removed by
     *   A's T6** (the first section went down with the v1 panel, D1) ⇒ the sentence above
     *   now reads as "the reason back then", and this key itself is one of the 45 dead
     *   keys in §5.112.
     *   the T6 brief's `Produces` line lists
     *   `onUnbind` in the table's interface, and **no render rule** says which state draws
     *   it ⇒ without it that prop is dead, and `unbind()` has **no other consumer anywhere
     *   in the UI** (read today: nothing under `apps/web/src` calls it except the panel's
     *   seven-action wrapper).
     * ⚠️ It collides with render rule 3 *on the letter* ("the actions column has no button
     *   on a `current` row"): that rule's load-bearing part is "an up-to-date row offers no
     *   Update" (which is exactly T7's assertion 5), and this quiet button does not touch
     *   it. Whether it stays is the controller's call (deleting it = the two places in the
     *   component).
     */
    unbind: 'Unbind',
    update: 'Update',
    updateAll: 'Update all',
    /*
     * ★ The explanation for the "every updatable row is disabled" case (added by Task 6).
     * ⚠️ Why it is needed: `updateAll()` **skips** `.disabled` bindings (spec §8), so in
     *   that case clicking "Update all" moves nothing — while the button is **enabled**
     *   (there really are updatable rows, disabled ones included). Without this sentence
     *   the user sees "I clicked and nothing happened", the silent failure this repo
     *   keeps writing rules about. The real way out is the **per-row** "Update": a single
     *   update asks once whether to enable the file as well (T4's `confirmEnable`) —
     *   so this sentence has to name that button.
     * ⚠️ It only appears in that case (a permanently visible hint is one nobody reads).
     */
    updateAllDisabledOnly:
      'Every updatable row is disabled — "Update all" skips those (it only updates enabled files). Use the "Update" button on that row.',
    check: 'Check',
    checking: 'Checking…',
    upToDate: 'Up to date',
    outdated: 'Update available',
    unbound: 'Not bound',
    missing: 'File missing',
    /*
     * ⚠️ The parenthetical is not padding: renaming a jar to `.jar.disabled` only
     *    stops the game from loading it — the file is still there and unchanged.
     *    "Disabled" alone reads as "we turned it off".
     */
    disabled: 'Disabled (the game will not load it)',
    /*
     * ⚠️★ Not the same statement as `outdated`, and the two must not be merged
     *    into one "an update exists": this version number does **not** exist
     *    upstream (a self-built or patched jar) ⇒ "Update" may replace the user's
     *    own build. Button wording and badge wording are kept apart on purpose
     *    (the rule lives on `compareLocalToLatest`).
     */
    unknownLocal: 'Upstream has no such version',
    /** Only for a **real** read failure (local read / upstream unreachable). "Never checked" is `notChecked`. */
    error: 'Failed',
    /*
     * ★★ `unchecked` (bound, file present, but **no reading yet in this process**)
     *    borrows this one.
     *
     * ⚠️★ Why it is not a second string: it says "there is no reading yet", and the
     *    page already says exactly that in **one other place** — the metadata line
     *    above the list (`lastChecked` pairs with this one) prints it whenever
     *    `state.lastCheckedAt === null`. Same sentence, so a second key with the
     *    same value would be two truths waiting to drift (this repo has deleted
     *    duplicate entries for exactly that).
     * ⚠️ And it must **never** be folded into `error`: `unchecked` exists precisely
     *    because saying "failed" there is a lie — nothing failed, nothing was read.
     */
    notChecked: 'Not checked yet',
    /** ⚠️ `{{time}}` is the reading time **within this process** (the panel formats it with `formatClock()`). */
    lastChecked: 'Last checked: {{time}}',
    /*
     * ★ The per-row clock (printed on **every** row of the table, added by Task 6,
     *   2026-09-24).
     * ⚠️ This is **not** the same statement as the one above: `lastChecked` prints the
     *   **list-level** `FileUpdatesState.lastCheckedAt`, while this one prints
     *   `FileItemView.lastCheckedAt` (when **this item** was last checked). The two can
     *   differ — an `autoUpdate`-off item is not refreshed by the launch check (T1's
     *   `FileBinding.autoUpdate` and T4's `startUp`) ⇒ within one process the list-level
     *   clock can be newer than this row's, so the two sentences have to stay apart.
     * ⚠️ Both cells are **in-process**: the per-item `lastCheckedAt` in the state file is
     *   **never** read into the view ⇒ after a restart there is no value, and then this
     *   prints **nothing at all** (never a fabricated timestamp).
     */
    rowChecked: 'This row last checked: {{time}}',
    /*
     * ★ The next two are **not in the plan's table**; they cover `FileItemView.lastKnownLatest`,
     *   the field T1/T4 added in their fix rounds (spec §8).
     *
     * ⚠️★ Why two separate strings: the `error` row says "this attempt failed", and it
     *    still owes the user "so what version did we last see, and when". When
     *    `lastKnownLatest` is `null` (cold start plus an unreachable upstream) there is
     *    **no version to report** ⇒ the honest move is to say so, never to borrow a
     *    version number from somewhere else.
     * ⚠️ Nor can it borrow `state.latestVersion`: the `error` variant of
     *    `FileItemState` has **no** `latestVersion` field at all (only `current` /
     *    `outdated` / `unknown-local` carry it — see `fileUpdates.ts`).
     */
    lastKnownLatest: 'Last read {{version}} ({{time}})',
    lastKnownNone: 'No successful read of the latest version yet this session.',
    /*
     * ★ The sentence for a **failed action** (`bind` / `update` / `updateAll` rejecting).
     *
     * ⚠️ Also absent from the plan's table, and it has **nowhere else to live**:
     *    `FileUpdatesState` has no field for "how this operation went" (T4's
     *    `apps/desktop/src/file-updates.ts` says so in the `bind()` note — the reject
     *    message is the only channel back to the renderer). Catch and display both live
     *    in the handler wrapper in `components/FileUpdatesPanel.tsx`.
     *    ⚠️★ Final fix wave correction (**this key is still live**): that file (v1's
     *    handler wrapper) was removed by A's T6; today the same landing spot is
     *    **`reasonOf` + `makeModFoldersHandlers`' `fail(...)` in
     *    `components/ModFoldersData.tsx`**, rendered by `ModDownloadPanel`'s
     *    `<Notice kind="bad">` (which is what uses `files.actionFailed`).
     * ⚠️ Cancelling the file dialog is **not** a failure (the main process returns the
     *    unchanged state), so every message that shows up here is a real failure.
     * ⚠️ Cost: `{{message}}` is the **main process's own wording**, which is Chinese ⇒
     *    this line mixes languages in the English UI. Same accepted cost as the `message`
     *    on an `error` row (Task 6 is told to print that reason verbatim).
     */
    actionFailed: 'That step did not work: {{message}}',
    confirmUpdateAll: 'Update {{count}} file(s) to the latest version?',
    busy: 'Updating {{name}}…',
    /*
     * ★ The variant with a percentage (the same action's second sentence, added by Task 6).
     * ⚠️ Why it has to be **two** keys: `FileUpdatesState.progress.percent` is
     *   `number | null` — when upstream gives no content length the main process has no
     *   percentage either (its own `total > 0 ? … : null`) ⇒ only the key above can be
     *   printed then. And i18next does **not** drop an `{{percent}}` with no value — it
     *   prints the braces verbatim ⇒ this cannot be one key with an optional segment.
     * ⚠️ The `%` lives in the string, not in the component: both languages need a place
     *   for it (the component only hands over the number, and it does **not** round it
     *   again — that would be a second rule for the same thing).
     */
    busyPercent: 'Updating {{name}}… ({{percent}}%)',
    runSummary: 'Updated {{ok}}, failed {{failed}}',
    /*
     * ⚠️★ This explanation **must** appear on the page (`routes/Files.tsx`); it is not
     *    optional: a browser user is looking at a table full of "Not bound" rows, and
     *    their first thought is "why is nothing clickable", not "I need the desktop app".
     *    This sentence is the answer to the first thought.
     */
    browserOnly:
      'Local file access happens in the desktop app only — a web page cannot touch your disk.',
    /*
     * ⚠️★ `{{reason}}` is filled by **different people on the two paths**; do not read it
     *    as one thing:
     *   · **browser**: the page fetches `/api/file-catalog` itself, and on failure fills in
     *     the server's machine-readable code (`catalog_unavailable` / `catalog_invalid` /
     *     `catalog_invalid_json`, plus `problems` when present). ⚠️ Those three codes have
     *     no better wording yet (a Task 7 follow-up), so the user sees the code itself —
     *     reporting the real reason beats replacing it with a generic "something failed".
     *   · **desktop**: `FileUpdatesState.catalogError` is written by the main process and
     *     **is already a complete sentence** (T4 prefixes it with 「目录拉取失败：」) ⇒ the
     *     panel prints it **as is** and does **not** wrap this key around it (that would
     *     print 「目录拉取失败：目录拉取失败：…」).
     * ⇒ Cost: the sentence has two sources and two render points (`routes/Files.tsx` and
     *   the panel); both say why.
     */
    catalogError: 'Could not load the catalog: {{reason}}',
    /*
     * ★ Not in the plan's table: what to say when **the desktop shell's half of the state
     *   cannot be read at all**.
     *
     * ⚠️ A different thing from `catalogError`: a catalog failure is the main process
     *    **handing back a state that carries the reason**; this one is "we never even got
     *    that state" (nobody answers the IPC channel — the silent failure mode
     *    `shared/desktop.ts` warns about in its header). Without it, that failure sits on
     *    "Loading…" forever, which is a **lie** (the note in `ShareIntro` records the same
     *    rule: if you cannot tell "slow" from "gone", you are lying).
     */
    stateError: 'Could not read the local state: {{reason}}',
    /*
     * ===================================================================
     * Part one: catalog rows (2026-10-03, Task 7)
     * ===================================================================
     * ⚠️★ Why every key below keeps the `files.` prefix (instead of opening a new
     *    `mods.` / `folders.` namespace): `/files` is this page's namespace, and the
     *    **raw-key leak scanner** (`RAW_KEY_RE` — ⚠️★ final fix wave correction: it used
     *    to live in `FileUpdateTable.tsx` (the one object v1's ⑲ and T7's ⑬ shared), and
     *    that file was removed by A's T6; today it lives in
     *    **`apps/web/src/components/ModFoldersData.tsx`**, consumed by
     *    `scripts/foldersrender.tsx`) only knows `files.` and `common.` ⇒ keeping the
     *    prefix means this batch is watched **without touching the scanner** (a new prefix
     *    plus a forgotten scanner extension means raw keys on that branch go unnoticed).
     */
    partOneTitle: 'Part one: mods in the catalog',
    /*
     * ⚠️★ Both filter choices live in the main process's `prefs` (spec §6.8 "remembered
     *    per machine", `desktop.ts`'s `setCatalogGameVersion` / `setTagFilter`) ⇒ the
     *    component is controlled: it draws the state's copy and keeps **no** second one
     *    in the renderer (two memories always drift apart one day).
     */
    catalogGameVersion: 'Game version',
    /*
     * ⚠️ "all must match" is not padding: tag filtering has **AND** semantics (a row
     *    survives only if it carries every selected tag, spec §6.8 / D4) ⇒ without it the
     *    user reads multi-select as OR and wonders why everything vanished.
     */
    catalogTags: 'Tags (all must match)',
    /*
     * ⚠️ It also **re-fetches the catalog** (`rescan` in `apps/desktop/src/mod-folders.ts`
     *    starts with `await queueLoadCatalog()`), so the label has to say so: when the
     *    catalog is unavailable this is the page's **only** "try again" entry point
     *    (v1 has its own "Check"; this channel has no equivalent).
     */
    catalogRescan: 'Rescan (re-fetch catalog)',
    /*
     * ★ Ruling 42: the first `getState()` **waits for a catch-up scan** (reading every
     *   jar's id, version and hash), so the very first frame has to say "scanning" —
     *   otherwise the user reads it as "this page is broken".
     */
    catalogScanning: 'Scanning…',
    catalogScanningHint:
      'The first load waits for a local scan (reading every jar id, version and hash); that can take a few seconds.',
    catalogUnavailable:
      'The catalog has not been fetched yet, so this list has nothing to show ("Rescan" fetches it again).',
    /*
     * ★★ Fix round 1, item 1 (2026-10-03 review): the catalog failed **this** time while the
     *    cached rows are still here.
     *
     * ⚠️★ Why it has to be a **separate** key (the one above cannot be reused): a failed
     *    catalog fetch does **not** clear the loaded copy (spec §8 keeps the cache) ⇒
     *    "this list is empty" and "the catalog is unavailable" are two independent facts.
     *    Folding them into one key lies to the user (the cached rows are right there) and
     *    throws away binding and "Open original page" along with them.
     * ⚠️ The wording has to say these rows are from the **previous** fetch.
     */
    catalogUnavailableRows:
      'The catalog could not be fetched this time - the rows below are from the previous fetch (bind, open page and update still work).',
    catalogNoRows:
      'No mods to list for this game version (the tag filter may also have removed every row).',
    catalogAllCurrent: 'Every mod in this table is up to date - there is nothing to update.',
    /* ⚠️ The main process writes one file at a time (`busy`), and rejects a second write. */
    catalogBusy:
      'A file is being written - every row button is disabled until it finishes (one file at a time).',
    colMod: 'Mod',
    colStatus: 'Status',
    /*
     * ★★ Ruling 13: the target (`official`) is **not guaranteed** to be in `candidates` —
     *    with an upstream target it comes from upstream (see `resolveTarget`) ⇒ only
     *    `targetSource` may say where that cell came from; the UI must never infer it.
     */
    targetSource: {
      catalog: 'Legal pinned version',
      upstream: 'Upstream latest',
    },
    /*
     * ★ States the user has to handle explicitly (spec §7.2 steps 4/5 and §8). Each keeps its
     *   **own** wording: folding them into one "cannot update" deletes the reason, which is
     *   the only lead the user has.
     * ⚠️★ `different-build` must **not** promise "same version" (2026-10-04 close-out wave):
     *   `compareLocalToRelease` lumps two inputs together — (1) identical version body (the
     *   real case `standardsettings`: `2.3+1.16.1` vs `2.3+1.16-1.16.1`) and (2) non-numeric
     *   segments on either side, where the two version strings **cannot be ordered** (measured:
     *   `HD_U_F9` vs `HD_U_F10` — two genuinely different versions). The old copy said
     *   "same version number", which is a lie for (2). Spec §8 has no separate state for it
     *   (`different` is not in the `ReleaseVerdict` union, so adding it means touching the
     *   contract) ⇒ these strings now state only what is known: the bytes differ.
     */
    verdictNewer: 'Local is newer',
    verdictDifferentBuild: 'Bytes differ from official',
    verdictUnknown: 'Cannot compare',
    verdictAmbiguous: 'More than one candidate',
    hintNewer:
      'Your local build is newer than the pinned one - we report it, never replace it (this list never downgrades).',
    hintDifferentBuild:
      'Your local copy has different bytes from the official release (the version numbers are either the same or cannot be ordered) - it is never replaced automatically; Update replaces it with the official build.',
    hintUnknown:
      'The local version cannot be read (or the version numbers cannot be ordered) - this row is never updated automatically.',
    /*
     * ★ Ruling 47: a `manual` release (the 54 OptiFine ones) gets **no update button at
     *   all** — the main process's `assertUpdatable` rejects it ⇒ this sentence is what
     *   the UI owes the user instead.
     */
    hintManual:
      'This one can only be downloaded by hand from its original page (OptiFine ships that way).',
    /*
     * ★★ `ambiguous` (two candidates, e.g. `optifine|1.7.2` / `speedrunigt|26.1`):
     *    `official` is `null` ⇒ the main process has **no** entry point that can install
     *    it (`updateCatalogRow`'s "no target right now") ⇒ the UI must not draw a button
     *    that would be refused; the only way out is the original page. The sentence has to
     *    carry both halves ("we do not guess" + "we do not install one for you").
     */
    hintAmbiguous:
      'This row has two candidates - we will not guess and we will not install one for you. Confirm yourself which one applies and use the links below to open the original pages.',
    candidate: 'Candidate: {{version}}',
    /*
     * ★ Per-row actions for part one (spec §6.8): bind local file / update (origin) /
     *   update (mirror, GitHub sources only) / open original page.
     * ⚠️ The two update buttons must be **two keys**: the mirror one only exists for
     *   GitHub sources (D5), and printing the same sentence on both leaves the user
     *   unable to tell which channel they pressed.
     */
    bindLocal: 'Bind local file',
    updateOrigin: 'Update (origin)',
    updateMirror: 'Update (mirror)',
    openPage: 'Open original page',
    /*
     * ★★ The previous run's summary (spec §7.4 / Ruling 52 item 5 / T6 §9.6 item 2).
     * ⚠️★ The wording has to say "**last** run": when a folder batch is refused **before**
     *    `bulkRun`, `lastRun` is not touched at all (all six of those guards sit before
     *    it) ⇒ the copy on screen may describe the previous run, and calling it "just now"
     *    would put a statement on screen that is no longer true.
     * ⚠️ `skipped` must be printed **per row** (`lastRunSkipped`): a bare count leaves the
     *    user unable to tell which of their mods was left alone — and "how many were
     *    skipped and why" is what spec §7.4 asks for.
     * ⚠️★ Sub-project C (D4): the **cancelled** count is its own slot - a cancel is not a
     *    failure, and folding it into `{{failed}}` would make the UI say "update failed"
     *    when the truth is "stopped because you asked". The per-row sentence is
     *    `lastRunCancelled`; it and `lastRunSkipped` are two different readings.
     */
    lastRunSummary:
      'Last run: {{ok}} updated, {{skipped}} skipped, {{failed}} failed, {{cancelled}} cancelled',
    lastRunSkipped: 'Skipped {{modid}}: {{reason}}',
    /*
     * ★ A separate key from `stateError`: this one is about the **new** channel
     *   (`modFolders.getState()`), that one about v1's (`fileUpdates`). The failure
     *   causes differ (channel nobody registered vs. the main process throwing), so they
     *   are not merged.
     */
    partOneStateError: 'Cannot get the mod catalog state: {{reason}}',
    /*
     * ===================================================================
     * Part two: mod folders (2026-10-03, Task 8)
     * ===================================================================
     * ⚠️★ Same prefix discipline as part one: always `files.` (the raw-key scanner only
     *    knows `files.` and `common.`, see the `partOneTitle` note above).
     * ⚠️★ No `⇒` (U+21D2) in any of these values: it is **not** in the pixel font subset
     *    and `check-font-coverage.mjs` scans `packages/shared/src/i18n` (measured on this
     *    machine: `⇒` and `▾` are MISSING from both subsets - the first one only appears
     *    in comments, the second is the little arrow in the brief's "download into ▾", so
     *    that control does not print it).
     */
    partTwoTitle: 'Part two: mod folders',
    /*
     * ⚠️ The second render point of the same statement as v1's `autoHint` (that switch
     *    never writes a file). Kept separate because the subject differs (v1's table vs.
     *    this folder layer) and this one has to mention that rows are judged from a scan.
     */
    partTwoHint:
      'Every row is judged from the scan reading; "Auto" only means it is checked and highlighted on launch - files are written only when you click.',
    /*
     * ★ First empty state: no folder bound yet. ⚠️ It is also the **only** binding entry:
     *    v1's "Choose mods folder" uses the old channel (`fileUpdates.bindFolder`, which
     *    matches items by jar name), and the new folder entity only exists behind
     *    `modFolders.bindFolder` (spec §6.7) - without this button the feature has no way
     *    in from the UI.
     */
    folderNone:
      'No mods folder is bound yet - bind one and its mods are judged against the catalog, with whatever is missing listed below.',
    /*
     * ★ Second empty state (the directory was moved or renamed): the binding stays, no
     *    update action is offered at all (spec §8). ⚠️ This one is the **badge** (short)
     *    and the hint below is the explanation - two keys because the badge has to fit
     *    into the head row's control line.
     */
    folderPathMissing: 'Path missing',
    folderPathMissingHint:
      'This directory cannot be read right now - the binding stays and its files take part in no update. Put the directory back, or unbind it.',
    /*
     * ★★ The **actionable** way out of the unknown-version case (spec §8: the folder
     *    head shows "unknown game version" and asks for a manual choice). This is the
     *    empty value of that select: picking it hands the version back to auto-detection
     *    (`setFolderGameVersion(folderId, null)` - the contract says null is not "leave
     *    it alone"), picking a concrete version writes it.
     *    ⚠️ Two statements, so two keys: this one says what the cell is, the hint below
     *    says what picking it does and what happens until then.
     */
    folderGameVersionAuto: 'Detect automatically',
    folderGameVersionHint:
      'This folder has no known game version yet - pick one for it first; until then no row offers an update button.',
    /*
     * ★★ The bulk channel selector (spec §6.8: "bulk must have a default, because one
     *    click drives N downloads"). ⚠️★ Its **scope is "Update all"** and the wording
     *    has to say so: a single row goes through its own "Update (origin) / (mirror)"
     *    buttons, and the bottom "Download" always uses the origin address (the reason is
     *    in the component note - the page must never send a mirror channel it cannot
     *    prove applies to that release).
     */
    folderBulkChannel: 'Channel for "Update all"',
    /*
     * ⚠️ `{{count}}` = `batchTargets(rows)` (how many rows really enter the batch - T1's
     *    predicate), the same idea as v1's `confirmUpdateAll`: you know how many files
     *    move before you click.
     */
    folderUpdateAll: 'Update all ({{count}})',
    /*
     * ★ Not in the brief's head-row list (a deviation, recorded in the report):
     *   `rescan(folderId)` already exists in the contract, and without this button the
     *   "no scan reading yet" and "game version cannot be inferred" states have **no**
     *   way out from the page (part one's "Rescan (re-fetch catalog)" only appears when
     *   the catalog itself is unavailable).
     */
    folderRescan: 'Rescan this folder',
    /*
     * ★★ The two channel options. ⚠️ Printing `hosts` on the mirror option is not
     *    decoration: `channelUrl` only yields an address when the release's host is in
     *    that mirror's hosts, and this choice drives N rows in one batch (see
     *    `folderBulkChannel`) ⇒ the option itself states the scope.
     */
    channelOrigin: 'Original address',
    channelMirror: '{{label}} ({{hosts}} only)',
    /*
     * ★★ After a catalog change, `prefs.bulkChannel` may hold an id that is no longer in
     *    the mirror table. ⚠️ Without an option for it, a `<select value=X>` with no X
     *    silently shows the first option (the screen lies while `setBulkChannel` was
     *    never called) - same rule as part one's `gameVersionOptions`: the stale value
     *    has to stay visible.
     */
    channelStale: 'Mirror {{id}} (no longer in the catalog)',
    /*
     * ★★ Ruling 64 (2026-10-03 T8 review): a **stale persisted value may be shown, but it
     *    must not be sent as a new action**. The key above lets the user see that the state
     *    drifted; this one says "and that is why Update all cannot be sent" - without it,
     *    that button is simply **not drawn** in this case (see `bulkChannelUsable` -
     *    ⚠️★ final fix wave correction: that function used to live in
     *    `ModFoldersPanel.tsx`, removed by A's T6; today it lives in
     *    **`components/ModFoldersData.tsx`**, and this key is rendered by
     *    **`components/ModDownloadPanel.tsx`**'s `<Notice kind="bad">`) and the user just
     *    wonders where it went.
     * ⚠️ The wording has to name the cell ("pick a channel that still exists above"): the
     *    catalog is not broken, the choice **saved on this machine** is out of date.
     */
    channelStaleHint:
      'The saved bulk channel is no longer in the catalog mirror table - "Update all" cannot be sent until you pick a channel that still exists above.',
    /*
     * ★ Third empty state: this folder **was read**, and not one recognizable mod is in it
     *   (rows is empty). ⚠️ It is **one sentence only**: the unrecognized file names are
     *   still listed below (those are real readings).
     * ⚠️★ Ruling 65 (2026-10-03 T8 review): this sentence belongs to the "was read" side
     *   **only** - a failed scan also leaves `rows` empty, and saying "no recognizable mod"
     *   then is an invented conclusion (the next key is what that case has to say). They are
     *   kept apart precisely because `rows.length === 0` cannot tell the two apart.
     */
    folderNoRows: 'No recognizable mod in this folder (not a Fabric mod, or not in the catalog).',
    /*
     * ★★ Ruling 65: **no successful scan reading** (the scan failed, or it never ran).
     *    ⚠️ It must never stand in for `folderNoRows`: one says "we read it, nothing is
     *    there", the other says "we do not know what is in there yet". Mixing them up shows
     *    part one's "cannot read this folder (…)" next to part two's "no recognizable mod".
     * ⚠️ The way out ("press Rescan this folder") belongs in the sentence: it is the only
     *    thing this case can do, and that button sits in the same head row.
     */
    folderNoReading:
      'No successful scan reading for this folder yet - what it contains is unknown (try "Rescan this folder").',
    /*
     * ★ The two scanned-but-not-updatable kinds (spec §8): no `fabric.mod.json`, or a
     *    modid the catalog does not have. ⚠️ They must stay apart: the first one's way
     *    out is "this is not a Fabric mod", the second one's is "the catalog lacks it" -
     *    folding them into one "unrecognized" deletes the only lead the user has.
     */
    folderUnrecognizedNoMeta: 'No fabric.mod.json: {{name}}',
    folderUnrecognizedNotInCatalog: 'Not in the catalog: {{name}}',
    /*
     * ★ The older-copies hint (D9.1: an update cleans them up). ⚠️ The names are printed
     *    one by one: "2 older copies" alone leaves the user unable to tell which files
     *    are about to go.
     * ★★ The consequence is a **separate key** (spec §4 D9.1: "the button copy states the
     *    consequence"): updating **deletes** them, and only after the new file is verified
     *    in place. Kept apart from the sentence above so that "is the consequence still on
     *    screen" has an assertion that can go red (`foldersrender` group ⑲ asserts it).
     */
    folderOldCopies: '{{count}} older copies: {{names}}',
    folderOldCopiesDeleted:
      ' - updating this row deletes them too (only after the new file is verified in place; anything that cannot be deleted is reported).',
    /*
     * ★★ The branch `FolderVerdict` has and `ReleaseVerdict` does not (spec §8: the
     *    `mmc-pack.json` cannot be read). ⚠️ It exists on the folder side only: the badge
     *    table is typed by `FolderVerdict` (a `Record<…, …>` ⇒ adding a kind fails to
     *    compile), so folder rows and catalog rows use that **same** table plus this
     *    branch (see `VERDICT_BADGES` - ⚠️★ final fix wave correction: it used to live in
     *    `FileUpdateTable.tsx`, removed by A's T6; today it lives in
     *    **`apps/web/src/components/ModFoldersData.tsx`**, rendered by `FolderJarList.tsx`
     *    and `VersionModList.tsx`).
     */
    verdictUnknownVersion: 'Game version unknown',
    /*
     * ★★ `missing-release` **is reachable in part two** (it is not in part one:
     *    `rowsForGameVersion` only returns mods that have a release for that game
     *    version). So it needs a badge and an explanation - without them that row shows
     *    no badge and no button, and the user cannot see why.
     */
    verdictMissingRelease: 'Not in the catalog for this version',
    hintMissingRelease:
      'The catalog has no release for it on this game version - shown only, never updated.',
    /*
     * ===================================================================
     * Bottom: the missing list (Task 8)
     * ===================================================================
     */
    partThreeTitle: 'Missing mods',
    /*
     * ⚠️ `{{version}}` = the state's `gameVersion` (this list is computed for it). Without
     *    it the user reads "missing" as relative to something else.
     */
    missingHint:
      'For game version {{version}}: mods the catalog has that no bound folder contains.',
    missingCount: '{{count}} missing',
    missingNone: 'Nothing missing - every catalog mod for this version is in a bound folder.',
    /*
     * ★★ The "download into" cell (spec §7.5). ⚠️ No little arrow here: the brief writes
     *    "download into ▾" and U+25BE is not in the pixel font subset (`check:font` would
     *    fail) - a native `<select>` draws its own arrow, we do not print a character.
     * ⚠️ The select's accessible name carries the mod name (that column is one identical
     *    select per row, the same reason as v1's `autoLabel`).
     */
    missingDownloadTo: 'Download into',
    missingDownloadToLabel: 'Download "{{name}}" into',
    /*
     * ★★ Two download buttons (**Critical** and **Ruling 62②**, 2026-10-03 T8 review).
     *
     * ⚠️★ Why two: `MissingModView` now carries that one `release` ⇒ the page can **prove**
     *    whether a mirror applies (`mirrorsForUrl`), exactly like part one ⇒ non-manual rows
     *    offer both channels and the accelerator is usable from this list too (which closes
     *    Ruling 62②).
     * ⚠️ They must be **two keys** (same reason as part one's pair): the mirror one only
     *    exists when that release's host really is in some mirror's `hosts`, and printing
     *    the same sentence on both leaves the user unable to tell which channel they pressed.
     * ⚠️ A `manual` row gets **neither** (`assertNotManual` refuses) - that one shows the
     *    "Open original page" link and the `hintManual` sentence instead.
     */
    missingDownloadOrigin: 'Download (origin)',
    missingDownloadMirror: 'Download (mirror)',
    /*
     * ★★ No folder can take it (after the version filter). ⚠️★ This case must **not**
     *    draw the Download button: the main process refuses when the folder's effective
     *    game version differs from the argument (`downloadMissing`), and drawing a button
     *    that is guaranteed to be refused is exactly what Ruling 47/48 forbids. The way
     *    out is in the sentence: bind a folder for this version, or set the existing one
     *    to it.
     */
    missingNoFolder:
      'No folder can take it - you need a bound folder whose game version is {{version}} and whose path still exists.',
    /*
     * ★★ The other three `missingStatus` cases (everything but `'ok'` has its own
     *    sentence - fix round 2). ⚠️★ The `folder-missing` one must **not** tell the user
     *    to rescan: `rescan` on a directory that does not exist only forgets the reading
     *    again - sending someone to press a button that cannot fix it is the wrong
     *    action (the main process note says the same). So that sentence does not contain
     *    the word "rescan" at all.
     */
    missingStatusFolderUnscanned:
      'A bound folder has no scan reading yet, so the missing list stays empty (pressing "Rescan this folder" on it fills it in).',
    missingStatusFolderMissing:
      'A bound folder path no longer exists, so the missing list stays empty (its files cannot be read). Put those directories back, or unbind them.',
    missingStatusCatalogUnavailable:
      'The catalog has not been fetched, so the missing list stays empty (fix the catalog first: part one\'s "Rescan (re-fetch catalog)" fetches it again).',
    /*
     * ★★ Feature detection (spec §6.8 / §8's last row): without `window.mcsr?.modFolders`
     *    part two says "needs desktop 0.0.5" while **part one and the v1 features keep
     *    working**.
     * ⚠️ It covers both shells: 0.0.4 (has `mcsr`, no `modFolders`) and a plain browser
     *    (no `mcsr` at all - there `browserOnly` above already explains why).
     */
    partTwoUnavailable:
      'This section needs desktop 0.0.5 (this client has no mod-folder support yet) - everything above keeps working.',
    /*
     * ===================================================================
     * A (mod-download page restructure) - Task 3: the tab skeleton
     * ===================================================================
     * ⚠️ Same prefix rule as the rest of this section: always `files.`
     * (the bare-key scanner only knows `files.` and `common.`).
     * ⚠️ No `=>` arrows (U+21D2) or `down triangle` (U+25BE) in these values:
     * neither is in the self-hosted pixel font subsets, and
     * `check-font-coverage.mjs` scans exactly this directory.
     * (The row's disclosure triangle is drawn with CSS for that reason.)
     */
    tabMods: 'Mod downloads',
    tabTools: 'Tool downloads',
    /*
     * ⚠️ A placeholder card must say why it is empty: a blank tab cannot be told
     * apart from a broken one (docs/pending.md §5.63).
     */
    toolsComingSoon:
      'Tool downloads are not built yet - there is nothing here on purpose, this is not a load failure.',
    /*
     * ⚠️ Both are the disclosure control's own label (spec §8's last row asks for
     * the marker **plus** the words): the marker alone is not readable.
     */
    expand: 'Expand',
    collapse: 'Collapse',
    /*
     * ⚠️ The folder path itself is never translated (it is disk content): this is
     * only the button that opens it in the OS file manager.
     */
    openFolder: 'Open folder',
    /*
     * ⚠️ One string, two render points (the top-row button and the section heading):
     * they are two ways of naming the same thing, and a second wording would turn
     * into two names for it.
     */
    allBoundFolders: 'Show all bound folders',
    /*
     * ★ The empty state of **one version** (spec §8's first row). It is deliberately
     * not `folderNone` (that one mentions the missing list, which this page no longer
     * renders), and it carries the only "add a folder" entry point on this page.
     */
    folderNoneVersion:
      'No mods folder is bound for this version yet - bind one and the mods inside it are checked against the catalog.',
    /** The heading of the version-grouped folder section (`{{version}}` is a version string). */
    versionFoldersTitle: 'Mod folders under {{version}}',
    /*
     * ⚠️ The short **badge** for "no successful scan yet" (Ruling 65: it must be told
     * apart from "there is nothing in there"). The long explanation is `folderNoReading`.
     */
    folderNoReadingBadge: 'No scan yet',
    /*
     * ===================================================================
     * A (mod download page restructure) - Task 4: the jar list inside an expanded folder
     * ===================================================================
     * ⚠️ Same prefix rule as the rest of this section: always `files.` (the bare-key
     * scanner only knows `files.` and `common.`); no `=>` (U+21D2) or down-triangle
     * (U+25BE) in these values (neither is in the self-hosted pixel font subsets).
     * ⚠️ The first three columns and the "status"/"actions" columns **reuse** the first
     * section's `colFile` / `colMod` / `colLocal` / `colStatus` / `colActions`: renaming
     * one column of the same table in one place only makes them look like two things.
     */
    /*
     * ★★ That column holds the **target release's page link** (`row.official.url` +
     * `openPage`), so the header says "original page" - aligned with what the cell does.
     * ⚠️★ Before the fix round this key was `colDownload` with the value "Download",
     * which **contradicted the cell**: its `<a href>` opens the release page (the
     * renderer never downloads anything; only the two "update" buttons write, through the
     * main process). Spec §4's sketch says `[Download]`, but `row.official.url` is a
     * "where to get it" address, and the cell's actual behaviour wins.
     */
    colReleasePage: 'Original page',
    colHomepage: 'Homepage',
    /*
     * ★★ The two links must be two separate strings (same reason as
     * `updateOrigin` / `updateMirror`): both read like "open ...", and printing the same
     * words for both leaves the user unable to tell which one they pressed.
     * ⚠️ The target cell reuses `openPage` (it opens that release's page); only the
     * homepage cell needs its own wording - "original page" and "project homepage" are
     * not the same place.
     */
    openHomepage: 'Open project homepage',
    /*
     * ★★ The **marker** on an unrecognized row (spec §8: "mark the row red, saying this
     * cannot be recognized as any catalog mod").
     * ⚠️★ The red is **not** carried by this string: it comes from the
     * `.jar--unrecognized` rule in `styles.css`. Printing only this sentence without
     * that red row is exactly the regression spec §9's knife ⑧ hunts for.
     * ⚠️ The two reasons (cannot read `fabric.mod.json` / not in the catalog) are told
     * **separately**: the explaining sentence reuses `folderUnrecognizedNoMeta` /
     * `folderUnrecognizedNotInCatalog`, the only implementation of those two sentences
     * (their only render point today, the old second section, is deleted in T6, so from
     * T4 on this table renders them - merging them would delete the user's only
     * actionable clue).
     */
    jarUnrecognized: 'Not recognized as a catalog mod',
    /*
     * ===================================================================
     * A (mod download page restructure) - Task 5: the "all mods for this version" section
     * ===================================================================
     * ⚠️ Same prefix rule as the rest of this section: always `files.`; no `=>` (U+21D2) or
     * down-triangle (U+25BE) in these values (neither is in the self-hosted pixel subsets).
     */
    /*
     * ★★ The heading **must carry the version** (without it the reader takes this section as
     * global - the old bottom list's `missingHint` wrote the same rule) plus the count.
     * ⚠️ The old key was `partThreeTitle` ("Missing mods") - this one is the **full** list.
     */
    versionModsTitle: 'All mods under {{version}} ({{count}})',
    /*
     * ⚠️ Catalog available but nothing for this version: **say so** (an empty table cannot be
     * told apart from "not rendered"), and it is a different thing from "catalog unavailable".
     */
    versionModsNone: 'There are no mods to list for this version.',
    /*
     * ★★ Downloading one mod. ⚠️ Not `missingDownloadOrigin` ("Download (origin)"): that
     * string is paired with a mirror button, and this section only ever sends the **origin**
     * channel (the reason and the cost are in `VersionModList`'s header).
     */
    downloadMod: 'Download',
    /*
     * ★★★ "Already downloaded": overlapping an **expanded** folder **replaces** the download
     * button (spec §9.9 / D5). It means "it is here where you are looking right now", not
     * "it is on this machine".
     */
    alreadyDownloaded: 'Already downloaded',
    /*
     * ★★ No folder can be a target (spec §8): the button is **disabled** and says why.
     * ⚠️ The `downloadTargets` rule is "path exists **and** it has a scan reading **and** it does
     * not already hold this modid" (the last half is B2) - a user may well have one folder that
     * fails one of them, so the sentence names the conditions that matter for this branch.
     */
    noFolderForDownload:
      'There is no folder to download into - a bound folder whose game version is {{version}}, whose path still exists and which has been scanned once.',
    /*
     * ★★ B2 (final fix wave): `downloadTargets` is the **legal** target list (the projection
     * drops folders that already hold the modid, because the main process refuses that target
     * unconditionally) ⇒ "no target at all" has two causes, and this is the other one.
     * ⚠️ It must be a different sentence from `noFolderForDownload`: one exit is "bind a
     * folder", the other is "expand that folder and you will see it".
     */
    alreadyInFolder:
      'This mod is already in {{folder}} - expand that folder to see it; there is nothing to download.',
    /*
     * ===================================================================
     * C (download progress and cancel) - Task 5: the one progress line all four
     * download sites share
     * ===================================================================
     * ⚠️ Same prefix rule as the rest of this section: always `files.`; no `=>` (U+21D2) or
     * down-triangle (U+25BE) in these values (neither is in the self-hosted pixel subsets).
     * ⚠️★ The cancel button **reuses the existing `common.cancel`** (present in both
     * languages): a second synonym would make the same click read differently per language.
     */
    /** ★ Sub-project C: the progress line (`{{done}}` / `{{total}}` are already "12.4 MB"). */
    progressLine: '{{done}} / {{total}} · {{percent}} · {{rate}} · {{eta}} left',
    /** ★ The per-folder batch line: which item out of how many, and which file. */
    progressBatch: 'Item {{index}}/{{count}} · {{name}}',
    /** ★ Writing to disk (no bytes - this is not network traffic). */
    progressInstall: 'Writing {{name}}…',
    /** ★ Cancel was requested; waiting for the run to stop. */
    progressCancelling: 'Cancelling…',
    /** ★ Why the button is greyed out while writing (a silent disabled button is a broken one). */
    progressCancelBlocked: 'Writing - please wait…',
    /** ★ The items the previous run had cancelled (`lastRun.cancelled`). */
    lastRunCancelled: 'Cancelled {{modid}}',
  },
};
