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
    resources: 'Resources',
    calendar: 'Calendar',
    seeds: 'Seeds',
    videos: 'Videos',
    profile: 'Profile',
    admin: 'Admin',
    login: 'Log in',
    register: 'Sign up',
    logout: 'Log out',
    language: 'Language',
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
};
