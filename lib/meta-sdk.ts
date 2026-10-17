/**
 * Loads Meta's JavaScript SDK once per page and resolves with `window.FB`, initialised for this app.
 * Browser only.
 */
let loading: Promise<any> | null = null

export function loadMetaSdk(appId: string, version = 'v25.0'): Promise<any> {
  const w = window as any
  if (w.FB) return Promise.resolve(w.FB)
  if (loading) return loading

  loading = new Promise((resolve, reject) => {
    const previous = w.fbAsyncInit
    w.fbAsyncInit = function () {
      if (typeof previous === 'function') previous()
      else w.FB.init({ appId, cookie: true, xfbml: true, version })
      resolve(w.FB)
    }
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.src = 'https://connect.facebook.net/en_US/sdk.js'
      script.async = true
      script.defer = true
      script.onerror = () => {
        loading = null
        reject(new Error('Meta’s sign-in script could not be loaded. Check the connection or an ad blocker.'))
      }
      document.body.appendChild(script)
    }
  })
  return loading
}
