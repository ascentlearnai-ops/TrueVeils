# Truveil Two-PC Demo

Updated installers verified October 26, 2026, 03:57 UTC (October 25, 10:57 PM Central).
These are unsigned Windows 10/11 x64 beta apps.
The two PCs can be on different Wi-Fi networks. No app account is required.

The current downloads include Tavi-guided onboarding, background operation,
25-35-word contextual chunk review, the concise score/why/timestamped-passage report,
microphone selection/echo cancellation and tab-sidebar polish. The existing extension
workflow is retained; no general/native browser-control setup was added. Local
Windows background/shared-audio checks are not a real Teams/Google Meet call or
two-PC accuracy evaluation. The last attended test did continue after switching
windows, but did not establish steady one-second timing or a valid accuracy score.
Do not use the old interrupted test's passage difference as a measured error rate.

## App Flow

The latest published apps have the flow below. Quit and reinstall older versions.
Tavi's speech bubbles give the next step without changing any permissions.

1. Interviewer: enter the private host access code, continue, then choose
   **New interview**. The service must accept the code before issuing a room.
2. Choose **Copy invitation** and send the copied message yourself. Its app link
   carries the candidate's code and server address, with both also included as a
   fallback. Never send the private host access code.
3. Candidate: open the invitation in Secure, enter a name, review permissions and
   choose **Join interview**. Allow the microphone prompt for preflight and wait
   for the interviewer. No app account is required.
4. Interviewer: check the joining name, approve the expected person, review the
   three confirmation checks and choose **Start interview**. Both use their usual
   calling app while Secure stays open. Captions feed the built-in checker;
   experimental pattern scores are not probabilities or proof of AI use.
5. Browser sharing is optional. Tavi explains the existing extension installation,
   pairing code and **Share this window** steps. Only the explicitly shared window
   is visible; individual tab closing needs separate permission and confirmation.
6. End the interview. The interviewer opens **Reports** to review the transcript,
   larger context reviews and events. A failed save shows a retry, not success.

## Install the Correct App

Close older Truveil windows, download the current installer and install it:

- Interviewer PC: [Truveil](https://truveil-recruiter.vercel.app/download.html).
- Candidate PC: [Truveil Secure](https://truveil-secure.vercel.app/download).

Install both latest apps together. Reload the Truveil extension in the candidate's
browser after reinstalling Secure; its current name is Truveil Interview Window
Sharing and its stable extension ID is unchanged.

Windows may show an unsigned-app warning. These installers are not code-signed;
do not disable Windows security. Their checksums are on the download pages.

## Connect

1. Keep this relay PC plugged in, online and with the lid open. A background
   supervisor requests that Windows stay awake; shutdown, manual sleep and lid
   actions can still interrupt it. This PC must stay running even when both demo
   participants are using other computers.
2. Open Truveil on the interviewer PC. Following the explicitly approved October
   25 temporary relay/tunnel restart and subsequent approved recovery, use this server address in **Connection
   settings** on both PCs:
   `wss://directly-honors-unlike-sets.trycloudflare.com`.
   The apps add the existing internal endpoint automatically. At the user's
   request, a newer fresh address replaced the earlier
   `attacks-locate-connecting-appreciated` address. All six synthetic public
   connection checks passed on the new address, without microphone/provider use.
   This does not establish real two-PC speech accuracy or diagnose earlier client failures.
   The current report-summary installers prefill the address above. Previously
   saved fields may still contain an older address: replace them in BOTH apps.
   The private host code is unchanged; publication did not restart the relay.
3. Open the private local file
   `C:\Users\kanag\Desktop\Hermes-Workspace\Truveil\TrueVeils\.readiness\temporary-relay\host-access.txt`.
   Enter it on the opening **Host access code** screen, choose **Continue to
   workspace**, then **New interview**. The candidate code appears only after
   the server accepts the host code and creates the interview. The server address
   must match the current address above under **Connection settings**.
   Never show this host code or API keys in Loom, screenshots or candidate messages.
   The host code is cleared after creating a room; enter it again for a new room.
4. Use **Copy invitation** and send the copied message. The app link includes the
   room code and server address, with both also included as a fallback. The
   candidate does not need the host code.
   Current room codes display `TRV-` followed by 16 characters. Every app and site
   is allowed by default. Enable **Set restrictions for this interview** only if
   needed and agreed; restrictions apply to the explicitly shared browser window,
   not to desktop apps. Closing a tab still needs consent and a manual action.
5. In Truveil Secure, enter the room code and a demo name, review the disclosure,
   and consent to the microphone only when ready to speak. For browser testing,
   explicitly select both optional tab-sharing and manual-close permissions.
   Leave optional external AI review off unless you separately intend to use it;
   the built-in checker does not require that external-provider opt-in.
6. Join, complete microphone preflight and wait. The interviewer approves the
   expected candidate and starts the interview. Speak naturally and check the
   actual words on both screens. Checker analysis waits for enough reliable words;
   its advisory signals are not a probability of AI authorship or proof of cheating.

### Keep Interviewer Speech Out of Candidate Captions

- In Secure, choose the candidate's headset under **Your microphone**. Use
  **Refresh microphones** to list available inputs; this does not start capture.
  Windows may hide device names before permission is granted. Avoid Stereo Mix,
  virtual call mixers or other inputs that contain both sides of the call.
- The candidate should wear headphones. Secure requests echo cancellation and
  transcribes the selected microphone only; it does not capture system/call audio.
  Interviewer speech audible through speakers or another nearby person can still
  reach that microphone. This is not reliable speaker separation on one shared mic.
- Microphone selection is locked during a session. End and rejoin to change it.
  An unavailable selected microphone fails visibly rather than switching sources.
- Review chunks target 30 words (25-35 where possible). Short tails are retained;
  scores still wait for 35 reliable continuous words. Actual results are not forced
  into high/low bands, and larger chunks do not prove improved detection accuracy.

## Browser Tabs

1. On the candidate PC, prepare a dedicated normal Chrome/Edge window containing
   only disposable demo tabs. Do not share personal tabs or unsaved work.
2. In Secure, choose **Open extension folder**. In `chrome://extensions` or
   `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select
   that folder. Expected extension ID: `dmemhcgadchjgfpleneioeenkcjepbhk`.
3. In Secure, choose **Connect browser**. In the prepared browser window, open the
   Truveil extension, enter its fresh one-use pairing code, and explicitly share
   that window. Closing must also be permitted in the extension.
4. Open a disposable page such as `https://example.com`. Check that Truveil shows
   its hostname. Choose **Close tab** and confirm; only that selected tab should
   close. Meeting sites remain protected.
5. Choose **Stop sharing** when finished. Rejoining a fresh room is required to
   grant permissions again after revocation. End the interview to stop audio and
   save the report locally on the interviewer PC.

## Limits and Shutdown

- If captions fail, the failure reason stays visible while confirmed text remains.
  Recovery respects the server's grant cooldown and rolling limits, so it can take
  ten seconds or longer. Retry is disabled while a request or scheduled retry is
  pending. No audio is sent while the speech connection is unavailable, and this
  connection does not upload backup recordings. Check actual provider access and
  available credits if authorization failures continue; never share the API key.

- Rooms expire after 30 minutes. A disconnect ends the room; create a new one and
  approve the candidate again. Do not expect silent reconnection.
- This temporary address works only while the relay and tunnel run. Restarting
  them gives a different address; update both app server fields before joining.
- To stop this PC's relay and release its awake request, run:

  ```powershell
  pwsh -NoProfile -File "C:\Users\kanag\Desktop\Hermes-Workspace\Truveil\TrueVeils\backend\demo\stop-temporary-host.ps1"
  ```

- Automated tests used fake audio and synthetic transcripts. The public transport
  and exact installer downloads were verified, but actual two-PC microphone
  accuracy, one-second caption timing and installed-browser behavior still need
  your attended rehearsal. Do not present simulated results as measured accuracy.
