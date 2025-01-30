// https://www.1eswiki.com/wiki/WCP_Cookie_Consent_API#Cookie_Consent_Library_-_JavaScript

import * as React from "react"
import "./cookie.scss"
import { useState } from "react"
import { Helmet, HelmetTags } from "react-helmet"

export enum CookieConsentCategories {
  /**
   * Cookies to perform essential website functions (sign-in, language settings,...)
   */
  Required = 'Required',
  /**
   * Cookies to understand how website is used, may be also used on 3rd party websites that are not owned or operated by Microsoft
   */
  Analytics = 'Analytics',
  /**
   * Cookies to show ads and content based on user social media profiles and activity on Microsoft websites
   */
  SocialMedia = 'SocialMedia',
  /**
   * Cookies to record which ads are already seen, clicked, or purchased
   */
  Advertising = 'Advertising',
}

export type CookieConsentBannerThemes = 'light' | 'dark' | 'high-contrast'

export type CookieConsent = Record<CookieConsentCategories, boolean>

export type CookieConsentManager = {
  /**
   * `true` if consent is required for current user region
   */
  readonly isConsentRequired: boolean

  /**
   * Returns consent state for all categories
   */
  getConsent(): CookieConsent

  /**
   * Returns consent state for a category.
   * @param consentCategory one of `consentCategories` values to get the consent state for
   * @returns `true` if consent was given, `false` otherwise
   */
  getConsentFor(consentCategory: CookieConsentCategories): boolean

  /**
   * Shows the preferences dialog box
   */
  manageConsent(): void
}

declare const WcpConsent: {
  init(
    culture: string,
    placeholderIdOrElement: string | HTMLElement,
    initCallback?: (err?: Error, siteConsent?: CookieConsentManager) => void,
    onConsentChanged?: (newConsent: CookieConsent) => void,
    theme?: CookieConsentBannerThemes,
    stylesNonce?: string
  ): void
} | undefined

const wcpConsentURL = "https://wcpstatic.microsoft.com/mscc/lib/v2/wcp-consent.js"
const wcpConsentPreconnect = new URL(wcpConsentURL).origin + "/"

export const CookieBanner = (props: { lang: string }) => {
  const [scriptLoaded, setScriptLoaded] = useState(typeof window !== 'undefined' && typeof WcpConsent !== 'undefined')
  const handleChangeClientState = (_newState: any, addedTags: HelmetTags, _removedTags: HelmetTags) => {
    if (addedTags && addedTags.scriptTags) {
      const foundScript = addedTags.scriptTags.find(({ src }) => src === wcpConsentURL)
      if (foundScript) {
        foundScript.addEventListener('load', () => setScriptLoaded(true), { once: true })
      }
    }
  }

  const initConsent = () => {
    // If they ship a bad build of the cookie banner, then even though the script is fully there
    // the global symbols won't be there
    if (typeof WcpConsent === 'undefined' || !WcpConsent) return
    WcpConsent.init(navigator.language, "cookie-banner", (err, siteConsent) => {
      if (err) {
        alert(err);
        return;
      }
      if (siteConsent) {
        onConsentChanged(siteConsent.getConsent());
        siteConsent.manageConsent();
      }
    }, onConsentChanged);


    function onConsentChanged(newConsent: CookieConsent) {
      // Right now, we don't use cookies at all, so this is a noop.
    }
  }

  return (
    <>
      <Helmet htmlAttributes={{ lang: props.lang }} onChangeClientState={handleChangeClientState}>
        {typeof window !== 'undefined' && typeof WcpConsent === 'undefined'
          && <script src={wcpConsentURL} async />}
        <link rel="preconnect" href={wcpConsentPreconnect} />
      </Helmet>

      <div id="cookie-banner" className="openx"></div>
      {(scriptLoaded && initConsent(), "")}
    </>
  )
}
