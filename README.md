# Zentariq Solutions

Responsive static landing page for Zentariq Solutions, with a Cloudflare Worker
endpoint for the “Let's Talk Growth” enquiry form.

## Run locally

Open `index.html` in a browser, or serve the repository root with a local static
server. Run the Worker tests with:

```sh
node --test tests/contact-worker.test.js
```

## Production deployment

The production site is hosted on Vercel at
[`https://prep.zentariq.com`](https://prep.zentariq.com). The Vercel GitHub
integration deploys changes pushed to `main`. The site is static and has no
build step; Vercel serves the HTML files and assets from the repository root.
`.vercelignore` excludes the Worker source, tests, and repository metadata from
the site deployment. `.github/workflows/validate.yml` runs the Worker tests on
each push.

The production site includes `index.html`, `work.html`, `thank-you.html`,
`assets/`, and `KBQ-assets/`. Check the Vercel deployment status on the commit
and verify the home page, work page, and image assets after publishing.

For a manual production deploy from the repository root, link the Vercel
project once and deploy:

```sh
npx vercel link
npx vercel deploy --prod
```

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
   (without a path). The production values use `https://prep.zentariq.com` and
   the Worker custom domain `https://contact.zentariq.com`.
5. The `contact-endpoint` meta tag in `index.html` points to the production
   Worker endpoint. Keep it synchronized if the Worker hostname changes.

`wrangler.toml` configures a Cloudflare rate-limit binding (five requests per
minute per visitor/IP and Cloudflare location) and contains no secrets. Never
put API keys in the page, repository, or a committed environment file. Local
Worker secrets belong in an ignored `.dev.vars` file; production secrets belong
in Cloudflare Worker settings.

The form validates required answers, phone and email formats, and positive
ordered budgets in both the browser and Worker. It uses a honeypot, limits
repeated requests, and redirects to `thank-you.html` only after the Worker
confirms that Resend accepted the email.
