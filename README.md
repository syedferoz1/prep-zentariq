# Zentariq Solutions

Responsive static landing page for Zentariq Solutions, with a Cloudflare Worker
endpoint for the “Let's Talk Growth” enquiry form.

## Run locally

Open `index.html` in a browser, or serve the repository root with a local static
server. Run the Worker tests with:

```sh
node --test tests/contact-worker.test.js
```

## GitHub Pages

The repository has no compile step. `.github/workflows/deploy-pages.yml` runs
the Worker tests and deploys `index.html` and `KBQ-assets/` to GitHub Pages on
each push to `main`.

The expected project site URL is
`https://syedferoz1.github.io/prep-zentariq/`; the Worker origin is
`https://syedferoz1.github.io`. At the time of this audit, the Pages URL
returned GitHub's "Site not found" 404. The deployment workflow is now included;
confirm its first run succeeds after pushing.

## Enquiry email setup

Email is sent server-side by the Cloudflare Worker in `src/contact-worker.js`
through Resend. The recipient is fixed in the Worker as `hello@zentariq.com`;
visitor data is never used as the sender.

1. Verify `zentariq.com` as a sending domain in Resend and choose an authenticated
   sender address on that domain.
2. From the repository root, deploy the Worker:

   ```sh
   npx wrangler deploy
   ```

3. Add the Resend API key as a Worker secret:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```

4. Confirm the Worker's `EMAIL_FROM` and `ALLOWED_ORIGIN` values in
   `wrangler.toml`. Set `ALLOWED_ORIGIN` to the exact origin hosting the site
   (without a path).
5. Copy the deployed Worker URL, append `/api/contact`, and set that full
   HTTPS URL in the `contact-endpoint` meta tag in `index.html`. Commit and push
   that configuration change to publish the functional form.

`wrangler.toml` configures a Cloudflare rate-limit binding (five requests per
minute per visitor/IP and Cloudflare location) and contains no secrets. Never
put API keys in the page, repository, or a committed environment file. Local
Worker secrets belong in an ignored `.dev.vars` file; production secrets belong
in Cloudflare Worker settings.

The form validates required answers, phone and email formats, and positive
ordered budgets in both the browser and Worker. It uses a honeypot, limits
repeated requests, and reports success only after Resend accepts the email.
