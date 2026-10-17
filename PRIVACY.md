# Tabpass Privacy Policy

**Effective date:** 16 October 2026

Tabpass is an open-source Chrome extension and relay, made by Migma ("we", "us"). It lets AI agents you connect read and use your open tabs. This policy covers the Tabpass extension and the Tabpass relay that Migma runs at `tabs.migma.ai`.

## The short version

- Tabpass sends page content only to an AI agent **you** connected, only when that agent asks, and only for a site **you** allowed. Sites you block are never shared.
- The relay passes data on to your agent. It does not store page content.
- No ads, no analytics, no tracking. We do not sell your data.
- You can run your own relay, and then your data does not go through Migma at all.

## What stays on your device

Tabpass keeps these in Chrome's storage on your computer. They are not sent to us.

- Your settings: the relay address, this browser's name (for example "Chrome on Mac"), whether agents are paused, and a random key that identifies this browser.
- The agents you connected: their name, access ("Read" or "Read and act"), their link, and the website that connected it, if one did.
- The sites you always allow and the sites you block.
- The last 60 agent calls (time, agent, tool, site, and whether it worked), shown under Activity.
- If you connect a Migma account: the connection id and secret, and the account's id, email and name, so the panel can show who is connected.
- Until you close Chrome: 10-minute site approvals and pending prompts.

You can clear the activity list in the side panel. Removing Tabpass deletes all of it.

## What leaves your device, and when

**To stay reachable.** While Tabpass is on, it keeps a connection open to the relay set under "This browser" (by default Migma's, `wss://tabs.migma.ai`). Over it, Tabpass sends:

- a key that proves this browser to that relay (made from this browser's random key; each relay gets a different one), this browser's name and the Tabpass version;
- for each agent you connected: its name, its access, and a one-way hash of its link (not the link itself);
- for a Migma connection: its connection id and secret, which the relay checks with Migma;
- a short "this browser is in use" signal when you switch to a Chrome window (at most every 30 seconds), so calls go to the browser you are using.

**When an agent you connected calls a tool.** Tabpass sends the result to the relay, which passes it to that agent:

- **List tabs:** the titles and addresses of your open tabs and the names of tab groups. Tabs on sites you blocked are not shown. This does not ask you first.
- **On a site you allowed** (Tabpass asks the first time): the page's text, links and tables; cleaned visible HTML structure without scripts, hidden fields or form values; the values shown in form fields (password fields are always hidden); the text you highlighted; a screenshot of the visible part of the tab; and the page's colors, fonts and image addresses. With "Read and act", the agent can also click, type and scroll there.
- Every answer includes the page's title and address.

Nothing is sent for a site you blocked, declined or did not answer.

**Migma's websites.** Only `migma.ai` and its subdomains can message Tabpass directly. They can ask whether Tabpass is installed, its version, this browser's name, and whether it is connected to Migma (and as which account). They can connect your browser only after you click "Connect" next to Migma in Tabpass or confirm in Tabpass's own window.

**Other websites.** A small script in every page lets a site ask to connect as an AI tool. Tabpass answers a site only right after you click on its page, or if you connected that site before, so sites cannot use it to tell that Tabpass is installed. The script does not read the page and sends nothing to us. A site connects only if you confirm in Tabpass's own window. It then gets a link for its AI, like one you would copy yourself, and the same site approvals apply.

## Who receives it

- **The agent you connected** (for example Claude, ChatGPT or Cursor, or a website you connected). What it does with the data is covered by that service's own privacy policy. Connect only agents you trust.
- **Migma**, if you connect your Migma account. Migma's AI then uses your tabs for what you ask it to do, under [Migma's privacy policy](https://migma.ai/privacy).
- **The relay** you configured. Migma runs the default relay on Cloudflare. It forwards calls and results between your browser and your agents and does not store page content, screenshots or highlighted text. To route calls, it keeps a little connection data: this browser's id and name, the agents connected to it (hashed links and access), when they connected and were last active, and short-lived sign-in codes. Like any web service, our hosting provider handles technical data such as IP addresses to deliver the connection. We do not use it to track you.
- **Your own relay**, if you set one under "This browser". Then token agents' data goes there, not to Migma. A Migma account connection always uses Migma's relay.

We do not sell, rent or trade your data. We do not use it for ads, profiling, or credit or lending decisions. The relay uses what passes through it only to deliver it. We share it with no one else, except when the law requires it.

## Limited Use

The use of information received through the Tabpass extension adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. Data is used only to provide Tabpass's single purpose: letting the agents you connect read and use the tabs you allow. People at Migma do not read it, unless you ask us to (for example in a support request), it is needed for security or abuse investigation, or the law requires it.

## Security

- Migma's relay is reached only over encrypted connections (`wss://` and `https://`).
- An agent's link is a secret. The relay sees only a hash of it. Treat it like a password, and disconnect the agent in the side panel if it leaks.
- A disconnected agent loses access on its next request. A switch in the panel pauses every agent at once.
- Tabpass runs only code that ships inside the extension. The relay sends data, never code.

## Your choices

- Block a site, or remove it from "Always allowed", under Sites.
- Pause all agents with the switch at the top of the side panel.
- Disconnect any agent, or your Migma account, in the side panel. You can also disconnect the browser in Migma's settings.
- Clear the activity list.
- Change the relay, or run your own: the relay is open source.
- Remove Tabpass to delete everything it stored on your device.

## Children

Tabpass is not meant for children under 13, and we do not knowingly collect their data.

## Changes

If we change this policy, we update this page and the date at the top. If a change affects what data leaves your browser, Tabpass tells you in the extension before the new handling applies.

## Contact

Questions or requests: [info@migma.ai](mailto:info@migma.ai)

Source code: [github.com/migmaai/tabpass](https://github.com/migmaai/tabpass)
