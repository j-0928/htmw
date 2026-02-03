// HTTP API client wrapper for HTMW

import * as cheerio from 'cheerio';
import type { AuthManager } from './auth.js';

const BASE_URL = 'https://app.howthemarketworks.com';

export class ApiClient {
    public auth: AuthManager;

    constructor(auth: AuthManager) {
        this.auth = auth;
    }

    private async getHeaders(): Promise<Record<string, string>> {
        return {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Cookie': await this.auth.getCookieString(),
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
        };
    }

    async get(path: string, headers: Record<string, string> = {}): Promise<Response> {
        await this.auth.ensureAuthenticated();

        const mergedHeaders = { ...await this.getHeaders(), ...headers };

        const response = await fetch(`${BASE_URL}${path}`, {
            method: 'GET',
            headers: mergedHeaders,
        });

        // Handle session expiry
        if (response.status === 401 || response.url.includes('/login')) {
            console.log('Session expired or redirected to login, refreshing...');
            await this.auth.refreshSession();
            // Retry
            return await fetch(`${BASE_URL}${path}`, {
                method: 'GET',
                headers: { ...await this.getHeaders(), ...headers },
            });
        }

        return response;
    }

    async getJson<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
        const response = await this.get(path, headers);
        const text = await response.text();
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

        // Handle session expiry
        if (response.status === 401 || response.url.includes('/login')) {
            console.log('Session expired or redirected to login, refreshing...');
            await this.auth.refreshSession();
            return await fetch(`${BASE_URL}${path}`, {
                method: 'POST',
                headers: { ...await this.getHeaders(), ...headers },
                body: isFormData ? body.toString() : JSON.stringify(body),
            });
        }

        return response;
    }

    async postJson<T>(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<T> {
        const response = await this.post(path, body, headers);
        const text = await response.text();
        try {
            return JSON.parse(text) as T;
        } catch (e) {
            console.error(`[ApiClient] Failed to parse JSON from ${path}. Status: ${response.status}. Body: ${text.substring(0, 1000)}`);
            throw new Error(`Failed to parse JSON from ${path}. See logs for details.`);
        }
    }
}
