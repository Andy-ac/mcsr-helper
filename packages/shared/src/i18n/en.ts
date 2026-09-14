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
    sections: 'SECTIONS',
    collapse: 'Collapse',
    expand: 'Expand',
    resources: 'Resources',
    calendar: 'Calendar',
    seeds: 'Seeds',
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
    comingSoon: 'We are at the M0 skeleton stage. Features are under construction.',
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
    capTypeSeed: 'Seeds',
    capTypeUser: 'Account management',
    capTypeAudit: 'Audit log',
    // ⚠️ `content.*`'s "type" half is not a content type: it is a cross-cutting
    //    policy over resources / videos / events (② direct edit, owner hard delete).
    capTypeContent: 'Content',
    capActionSubmit: 'Submit',
    capActionEditOwn: 'Edit your own',
    capActionEditAny: 'Edit published entries',
    capActionEditUnpublished: 'Edit unpublished entries',
    capActionFeature: 'Set featured / official',
    capActionModerateContent: 'Take content down or restore it',
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
    capDescSeedReview: 'Review seed submissions',
    capDescUserModerate: 'Manage accounts and roles',
    capDescAuditRead: 'Read the audit log',
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
    desc: 'The resource library, calendar and seed sharing in one window you can leave open. Windows 10 / 11, 64-bit.',
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

    filterOverworld: 'Overworld structure',
    filterNether: 'Nether bastion',
    filterAny: 'Any',

    variations: 'Variations',
    variationsHint:
      'Pick a group first, then tick the entries inside it. Several ticks mean "all of these".',
    variationsExpand: 'Expand',
    variationsCollapse: 'Collapse',
    variationsClear: 'Clear variations',
    variationsSelected: '{{count}} selected',
    /**
     * ⚠️ Be honest about where the vocabulary **comes from**.
     *
     * Upstream has no "list every variation" endpoint, so this list is the tree
     * from their docs PLUS everything we have actually seen in live results.
     * Both halves have to be said, otherwise people will assume the list is complete
     * (it is not, and upstream keeps adding entries).
     */
    variationsSource:
      'Entries come from the upstream documentation tree, plus anything we have actually seen in live results.',

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
     * ⚠️ The 503 is an operator kill switch (`MCSR_SEED_WRITE_DISABLED`), **not** a
     * permission problem. The server deliberately sends no Retry-After: nobody knows
     * when it will be turned back on.
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

    // ---- Group and structure names ----
    /**
     * ⚠️ Group names are a **lookup table**, not a list of the legal groups.
     *
     * The real list comes from `groupVariations()` grouping the entries we actually
     * have (see shared/seed.ts) — when upstream adds a group it shows up on its own,
     * merely without a translated name, and falls back to the raw group id.
     * Do **not** add an array of "all legal groups" here: upstream's next group would
     * then silently disappear from the UI.
     */
    group: {
      biome: 'Biome',
      chest: 'Chest loot',
      type: 'Structure shape',
      bastion: 'Bastion',
      end_tower: 'End tower',
    },
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
     * ★ The single most important line in this section.
     *
     * We do **not** detect liveness (no API keys, no polling — deliberately out
     * of scope), so there is no "live now" badge. Wording that implies one is a
     * lie the user notices within a week: a channel is clearly offline and we
     * show nothing either way. Saying "these are channels" is always true.
     */
    recordsChannels:
      'These are **channels**, not a "who is live right now" board — we do not detect liveness, so there is no live badge.',
    relationToVideos:
      'How this differs from the "Videos" section: that one is whatever anyone posted (constantly changing), this one is a slow-moving curated list.',

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
};
