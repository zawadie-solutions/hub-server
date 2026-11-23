# Face Match for Mutual: Chrome extension (internal)

A moderation aid. On a profile page it checks whether the photos in that profile's **own gallery**
show the same person as the **profile photo**, and tells the reviewer which photos to look at. It is
a client of the hub's Face Match (`POST /face-match/match`), so the face recognition itself runs on
the Zawadie hub, not in the browser.

It prompts a human to look. It does not decide anything: a gallery with friends, family, pets or
scenery is normal, and a "no match" is not proof of a fake profile.

## Use it

1. **Install (once).** In Chrome open `chrome://extensions`, switch on *Developer mode*, choose
   *Load unpacked* and pick this `extension` folder. Needs Chrome 116 or newer. For a team, an admin
   can force-install it through Google Workspace instead.
2. **Sign in to the hub** in a normal tab, as you do for any hub solution. The extension uses that
   sign-in; it never sees or stores your password.
3. Open the profile page and click the **Face Match icon** on the toolbar. The side panel opens.
4. First time only: open *Hub address* and enter the hub's address, e.g.
   `https://your-hub.example.com/face-match`, then *Save*.
5. Press **Pick the profile photo**, then click the profile photo on the page.
6. Press **Check the gallery**. The first time on a site, Chrome asks to allow the extension to read
   that site's photos and reach the hub; allow it.
7. Read the result. Each gallery photo gets a badge on the page and a row in the panel:
   *Matches profile photo*, *Possible match*, *No match*, *No face found* (normal for scenery),
   *Couldn't read this photo*. Photos that need a look come first, and *Show on page* scrolls to one.

Group photos: every face in the photo is compared and the best one is used, and the row says so.

## What it asks Chrome for, and why

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Clicking the toolbar icon lets it read the profile page you are on, only that tab, only then |
| `sidePanel` | The panel stays open while you click around the page |
| `storage` | Saves one thing: the hub address |
| Optional site access | Asked at the moment of use, per site: the photos' address, and the hub. Nothing is granted in advance |

It does not run on pages in the background, and it has no analytics.

## Privacy

- Photos go to **your hub only** (over https; plain http is refused except for localhost), to be compared.
  The hub processes them in memory and stores nothing.
- The extension **saves no photos, no scores and no results.** They live in the open panel and vanish when
  you close it or press *Clear*. The only stored value is the hub address.
- Photos are sent under neutral names (`profile.jpg`, `gallery-3.jpg`), so the hub's log, which keeps file
  names, never holds a user's own file names.
- Only the page you are on is read, only when you press a button, and only its photos.

**Use it only where Mutual has authorised it.** The faces are Mutual's users', and face comparison is
biometric processing: get Mutual's written go-ahead, and confirm that their users' consent covers it, before
pointing it at real profiles. Test with fake profiles until then.

## Limits (version 0.1)

- **Finding the photos is generic.** It takes the large photos on the page. Mutual's page has not been
  looked at yet, so there is no site-specific logic: the reviewer picks the profile photo, and the gallery is
  every other photo of at least 120 px. A site adapter can make that automatic once we see the page.
- Photos shown as CSS backgrounds, or inside frames, are not seen. Galleries that load as you scroll: scroll
  to the end first, then press *Check the gallery*.
- The profile photo must show exactly one face. With none or several, it says so instead of guessing.
- More faces compared means more chances of a wrong "possible". The best-matching face is used, and with a
  big group photo that can happen by chance. Treat "possible" on group photos with extra care.
- It cannot see why a photo is unusable beyond the hub's warnings (small face, blur, turned head); no
  warning does not mean the result is reliable.
- One profile at a time.

## How it was tested

A real Chrome 158 loaded the extension and ran the whole flow against a fake profile page, a separate
"image host" address, and a stand-in hub (the real Face Match behind a sign-in cookie): picking the profile
photo through an overlay, the not-signed-in prompt, the check after signing in, group photos, a landscape with
no face, badges on the page, *Clear*, and neutral file names at the hub. All 25 checks passed. The unit tests for
the panel's logic are in `../tests/extension.test.js`.

**Not tested yet:** Chrome's own permission prompt (a script can't click it), and sign-in against the real
hub, whose cookie and domain differ from the stand-in's. Try the real hub with a test account first. If the
sign-in is not picked up there, the fix is a small access token for the extension.
