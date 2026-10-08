import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/contact-worker.js';

const origin = 'https://syedferoz1.github.io';
const validSubmission = {
    fullName: 'Ari Example',
    phoneNumber: '+1 (555) 123-4567',
    businessEmail: 'ari@example.com',
    businessDescription: 'We provide accounting services.\nOur customers are small businesses.',
    businessLocation: 'Kansas City, Missouri',
    businessVision: 'Grow our regional customer base.',
    budgetMinimum: 1000,
    budgetMaximum: 2500,
    website: ''
};

function makeEnv({ rateLimited = false } = {}) {
    return {
        ALLOWED_ORIGIN: origin,
        EMAIL_FROM: 'Zentariq Solutions <enquiries@zentariq.com>',
        RESEND_API_KEY: 'test-api-key',
        CONTACT_RATE_LIMITER: {
            limit: async () => ({ success: !rateLimited })
        }
    };
}

function makeRequest(body = validSubmission, options = {}) {
    return new Request('https://worker.example/api/contact', {
        method: options.method || 'POST',
        headers: {
            Origin: options.origin || origin,
            'CF-Connecting-IP': options.ip || '203.0.113.10',
            'Content-Type': 'application/json'
        },
        body: options.method === 'OPTIONS' ? undefined : JSON.stringify(body)
    });
}

test('preflight returns the configured CORS origin', async () => {
    const response = await worker.fetch(makeRequest(undefined, { method: 'OPTIONS' }), makeEnv());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('rejects an unapproved origin before contacting the email provider', async () => {
    const response = await worker.fetch(makeRequest(validSubmission, { origin: 'https://attacker.example' }), makeEnv());
    assert.equal(response.status, 403);
});

test('validates all required fields and budget range on the server', async () => {
    const invalid = { ...validSubmission, businessDescription: '', budgetMinimum: 5000 };
    const response = await worker.fetch(makeRequest(invalid), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.ok(body.fields.businessDescription);
    assert.ok(body.fields.budgetMaximum);
});

test('blocks submissions that exceed the configured rate limit', async () => {
    const response = await worker.fetch(makeRequest(), makeEnv({ rateLimited: true }));
    assert.equal(response.status, 429);
});

test('fails closed if the rate-limit binding is unavailable', async (context) => {
    context.mock.method(console, 'error', () => {});
    const env = makeEnv();
    env.CONTACT_RATE_LIMITER.limit = async () => {
        throw new Error('binding unavailable');
    };
    const response = await worker.fetch(makeRequest(), env);
    assert.equal(response.status, 503);
});

test('rejects a filled honeypot and missing email configuration', async (context) => {
    context.mock.method(console, 'error', () => {});
    const spam = await worker.fetch(makeRequest({ ...validSubmission, website: 'bot-filled' }), makeEnv());
    const missingConfig = await worker.fetch(makeRequest(), {
        ...makeEnv(),
        RESEND_API_KEY: ''
    });
    assert.equal(spam.status, 400);
    assert.equal(missingConfig.status, 503);
});

test('sends every answer to the fixed destination with a safe subject and reply-to', async (context) => {
    let sentEmail;
    context.mock.method(globalThis, 'fetch', async (_url, options) => {
        sentEmail = JSON.parse(options.body);
        return new Response('{"id":"email-test-id"}', { status: 200 });
    });

    const response = await worker.fetch(makeRequest({
        ...validSubmission,
        to: ['attacker@example.com'],
        fullName: 'Ari Example\r\nBcc: attacker@example.com'
    }), makeEnv());
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(result, { sent: true });
    assert.deepEqual(sentEmail.to, ['hello@zentariq.com']);
    assert.equal(sentEmail.reply_to, validSubmission.businessEmail);
    assert.equal(sentEmail.subject.includes('\r'), false);
    assert.match(sentEmail.text, /Full Name: Ari Example\nBcc: attacker@example\.com/);
    assert.match(sentEmail.text, /Phone: \+1 \(555\) 123-4567/);
    assert.match(sentEmail.text, /Business Email: ari@example\.com/);
    assert.match(sentEmail.text, /Our customers are small businesses\./);
    assert.match(sentEmail.text, /Kansas City, Missouri/);
    assert.match(sentEmail.text, /Grow our regional customer base\./);
    assert.match(sentEmail.text, /Minimum: \$1,000/);
    assert.match(sentEmail.text, /Maximum: \$2,500/);
});

test('does not return success when the email provider rejects delivery', async (context) => {
    context.mock.method(console, 'error', () => {});
    context.mock.method(globalThis, 'fetch', async () => new Response('{"error":"rejected"}', { status: 422 }));
    const response = await worker.fetch(makeRequest(), makeEnv());
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'Unable to send enquiry.' });
});
