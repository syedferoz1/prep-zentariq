const DESTINATION = 'hello@zentariq.com';
const MAX_BODY_BYTES = 40_000;
const MAX_ANSWER_LENGTH = 10_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[0-9().\s-]+$/;

function jsonResponse(body, status, origin) {
    const headers = new Headers({
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });

    if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'Content-Type');
        headers.set('Access-Control-Max-Age', '86400');
        headers.set('Vary', 'Origin');
    }

    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
}

function validateSubmission(input) {
    const values = {
        fullName: cleanText(input.fullName),
        phoneNumber: cleanText(input.phoneNumber),
        businessEmail: cleanText(input.businessEmail),
        businessDescription: cleanText(input.businessDescription),
        businessLocation: cleanText(input.businessLocation),
        businessVision: cleanText(input.businessVision)
    };
    const errors = {};

    if (!values.fullName) errors.fullName = 'Enter your full name.';
    else if (values.fullName.length > 120) errors.fullName = 'Your name must be 120 characters or fewer.';

    const phoneDigits = values.phoneNumber.replace(/\D/g, '').length;
    if (!values.phoneNumber) errors.phoneNumber = 'Enter your phone number.';
    else if (!PHONE_PATTERN.test(values.phoneNumber) || phoneDigits < 7 || phoneDigits > 15) {
        errors.phoneNumber = 'Enter a valid phone number with 7 to 15 digits.';
    }

    if (!values.businessEmail) errors.businessEmail = 'Enter your business email.';
    else if (values.businessEmail.length > 254 || /[\r\n]/.test(values.businessEmail) || !EMAIL_PATTERN.test(values.businessEmail)) {
        errors.businessEmail = 'Enter a valid email address.';
    }

    for (const field of ['businessDescription', 'businessLocation', 'businessVision']) {
        if (!values[field]) errors[field] = 'This answer is required.';
        else if (values[field].length > MAX_ANSWER_LENGTH) {
            errors[field] = 'Your answer must be 10,000 characters or fewer.';
        }
    }

    const minimum = input.budgetMinimum;
    const maximum = input.budgetMaximum;
    if (typeof minimum !== 'number' || !Number.isFinite(minimum) || minimum <= 0) {
        errors.budgetMinimum = 'Enter a positive minimum budget.';
    }
    if (typeof maximum !== 'number' || !Number.isFinite(maximum) || maximum <= 0) {
        errors.budgetMaximum = 'Enter a positive maximum budget.';
    }
    if (!errors.budgetMinimum && !errors.budgetMaximum && minimum > maximum) {
        errors.budgetMaximum = 'Maximum budget must be at least the minimum budget.';
    }

    return {
        errors,
        values: { ...values, budgetMinimum: minimum, budgetMaximum: maximum }
    };
}

function createEmail({ values, env }) {
    const safeName = values.fullName.replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    const budget = (value) => new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }).format(value);
    const separator = '--------------------------------';
    const text = [
        'NEW GROWTH ENQUIRY',
        'ZENTARIQ SOLUTIONS',
        '',
        separator,
        '',
        'CONTACT DETAILS',
        '',
        `Full Name: ${values.fullName}`,
        `Phone: ${values.phoneNumber}`,
        `Business Email: ${values.businessEmail}`,
        '',
        separator,
        '',
        'BUSINESS INFORMATION',
        '',
        '01 — What does your business do, and who do you serve?',
        values.businessDescription,
        '',
        '02 — Where are you currently running your business from?',
        values.businessLocation,
        '',
        '03 — Where do you want your business to be in the next few years?',
        values.businessVision,
        '',
        separator,
        '',
        'MONTHLY MARKETING BUDGET',
        '',
        `Minimum: $${budget(values.budgetMinimum)}`,
        `Maximum: $${budget(values.budgetMaximum)}`,
        '',
        separator,
        '',
        'Submitted through:',
        'Zentariq Solutions Website'
    ].join('\n');

    return {
        from: env.EMAIL_FROM,
        to: [DESTINATION],
        reply_to: values.businessEmail,
        subject: `New Growth Enquiry — ${safeName} — Zentariq Solutions`,
        text
    };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const allowedOrigin = env.ALLOWED_ORIGIN;

        if (!allowedOrigin || origin !== allowedOrigin) {
            return jsonResponse({ error: 'Origin not allowed.' }, 403);
        }

        if (request.method === 'OPTIONS') {
            return jsonResponse({}, 204, allowedOrigin);
        }

        if (new URL(request.url).pathname !== '/api/contact' || request.method !== 'POST') {
            return jsonResponse({ error: 'Not found.' }, 404, allowedOrigin);
        }

        if (!env.CONTACT_RATE_LIMITER || !env.RESEND_API_KEY || !env.EMAIL_FROM) {
            console.error('Contact Worker is missing an email or rate-limit binding.');
            return jsonResponse({ error: 'Enquiry service is not configured.' }, 503, allowedOrigin);
        }

        const ipAddress = request.headers.get('CF-Connecting-IP');
        if (!ipAddress) return jsonResponse({ error: 'Unable to validate request.' }, 400, allowedOrigin);

        let rateLimit;
        try {
            rateLimit = await env.CONTACT_RATE_LIMITER.limit({ key: ipAddress });
        } catch {
            console.error('Contact Worker could not access its rate-limit binding.');
            return jsonResponse({ error: 'Enquiry service is temporarily unavailable.' }, 503, allowedOrigin);
        }
        if (!rateLimit.success) {
            return jsonResponse({ error: 'Too many submissions. Please try again later.' }, 429, allowedOrigin);
        }

        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > MAX_BODY_BYTES) {
            return jsonResponse({ error: 'Submission is too large.' }, 413, allowedOrigin);
        }

        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
            return jsonResponse({ error: 'Expected a JSON submission.' }, 415, allowedOrigin);
        }

        const rawBody = await request.text();
        if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
            return jsonResponse({ error: 'Submission is too large.' }, 413, allowedOrigin);
        }

        let input;
        try {
            input = JSON.parse(rawBody);
        } catch {
            return jsonResponse({ error: 'Invalid request body.' }, 400, allowedOrigin);
        }

        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            return jsonResponse({ error: 'Invalid request body.' }, 400, allowedOrigin);
        }
        if (typeof input.website === 'string' && input.website.trim()) {
            return jsonResponse({ error: 'Unable to accept this submission.' }, 400, allowedOrigin);
        }

        const { errors, values } = validateSubmission(input);
        if (Object.keys(errors).length) {
            return jsonResponse({ error: 'Please check the submitted fields.', fields: errors }, 400, allowedOrigin);
        }

        let resendResponse;
        try {
            resendResponse = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.RESEND_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(createEmail({ values, env })),
                signal: AbortSignal.timeout(10_000)
            });
        } catch {
            console.error('Resend request failed before a response was received.');
            return jsonResponse({ error: 'Unable to send enquiry.' }, 502, allowedOrigin);
        }

        if (!resendResponse.ok) {
            console.error(`Resend rejected an enquiry with status ${resendResponse.status}.`);
            return jsonResponse({ error: 'Unable to send enquiry.' }, 502, allowedOrigin);
        }

        return jsonResponse({ sent: true }, 200, allowedOrigin);
    }
};

export { createEmail, validateSubmission };
