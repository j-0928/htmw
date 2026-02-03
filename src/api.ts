// HTTP API client wrapper for HTMW

import * as cheerio from 'cheerio';
import type { AuthManager } from './auth.js';

import { setGlobalDispatcher, Agent } from 'undici';

const BASE_URL = 'https://app.howthemarketworks.com';

// Configure global dispatcher with higher timeouts for Render
setGlobalDispatcher(new Agent({
    connect: { timeout: 30000 },
    bodyTimeout: 30000,
    headersTimeout: 30000,
    keepAliveTimeout: 10000, // shorter keep-alive to avoid stale connections
    keepAliveMaxTimeout: 30000
}));

export class ApiClient {
    public auth: AuthManager;

    constructor(auth: AuthManager) {
        this.auth = auth;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        return {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Cookie': await this.auth.getCookieString(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
        };
    }

    async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
        await this.auth.ensureAuthenticated();

        const mergedHeaders = { ...await this.getHeaders(), ...headers };

        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'GET',
            headers: mergedHeaders,
        });

        // Read body to check for login page if it's 200 but redirected
        const text = await response.text();
        if (response.status === 401 || response.url.includes('/login') || (response.status === 200 && text.includes('UserName') && text.includes('Password'))) {
            console.log('Session expired or redirected to login, refreshing...');
            await this.auth.refreshSession();

            const secondResponse = await fetch(`${BASE_URL}${path}`, {
                method: 'GET',
                headers: { ...await this.getHeaders(), ...headers },
            });
            return secondResponse;
        }

        // Return a new response object since we consumed the body
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });

        return response;
    }

    async getJson<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
        const response = await this.get(path, headers);
        const contentType = response.headers.get('content-type');
        const text = await response.text();

        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Expected JSON from ${path} but got ${contentType || 'unknown'}. Content: ${text.substring(0, 200)}`);
        }

        try {
            return JSON.parse(text) as T;
        } catch (e) {
            console.error(`[ApiClient] Failed to parse JSON from ${path}. Status: ${response.status}. Body: ${text.substring(0, 1000)}`);
            throw new Error(`Failed to parse JSON from ${path}. See logs for details.`);
        }
    }

    async getHtml(path: string): Promise<cheerio.CheerioAPI> {
        const response = await this.get(path);
        const html = await response.text();
        return cheerio.load(html);
    }

    async post(path: string, body: URLSearchParams | Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
        await this.auth.ensureAuthenticated();

        const isFormData = body instanceof URLSearchParams;
        const mergedHeaders: Record<string, string> = {
            ...await this.getHeaders(),
            'Content-Type': isFormData
                ? 'application/x-www-form-urlencoded'
                : 'application/json',
            ...headers
        };

        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: mergedHeaders,
            body: isFormData ? body.toString() : JSON.stringify(body),
        });

        // Read body to check for login page if it's 200 but redirected
        const text = await response.text();
        if (response.status === 401 || response.url.includes('/login') || (response.status === 200 && text.includes('UserName') && text.includes('Password'))) {
            console.log('Session expired or redirected to login, refreshing...');
            await this.auth.refreshSession();

            const secondResponse = await fetch(`${BASE_URL}${path}`, {
                method: 'POST',
                headers: { ...await this.getHeaders(), ...headers },
                body: isFormData ? body.toString() : JSON.stringify(body),
            });
            return secondResponse;
        }

        // Return a new response object since we consumed the body
        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        });

        return response;
    }

    async postJson<T>(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<T> {
        const response = await this.post(path, body, headers);
        const contentType = response.headers.get('content-type');
        const text = await response.text();

        if (!contentType || !contentType.includes('application/json')) {
            throw new Error(`Expected JSON from ${path} but got ${contentType || 'unknown'}. Content: ${text.substring(0, 200)}`);
        }

        try {
            return JSON.parse(text) as T;
        } catch (e) {
            console.error(`[ApiClient] Failed to parse JSON from ${path}. Status: ${response.status}. Body: ${text.substring(0, 1000)}`);
            throw new Error(`Failed to parse JSON from ${path}. See logs for details.`);
        }
    }
}
