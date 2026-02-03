// Authentication and session management for HTMW

import { CookieJar, Cookie } from 'tough-cookie';
import * as cheerio from 'cheerio';
import type { Config } from './types.js';

const BASE_URL = 'https://app.howthemarketworks.com';

export class AuthManager {
    private cookieJar: CookieJar;
    private config: Config;
    private isAuthenticated: boolean = false;

    constructor(config: Config) {
        this.config = config;
        this.cookieJar = new CookieJar();
    }

    async login(): Promise<boolean> {
        try {
            // First, get the login page to capture cookies and hidden fields
            const loginPageResponse = await fetch(`${BASE_URL}/login`, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
            });

            // Store cookies from initial request
            const setCookies = loginPageResponse.headers.getSetCookie?.() || [];
            for (const cookie of setCookies) {
                await this.cookieJar.setCookie(cookie, BASE_URL);
            }

            // Parse HTML to find hidden fields (needed for ASP.NET)
            const html = await loginPageResponse.text();
            const $ = cheerio.load(html);

            const formData = new URLSearchParams();

            // Add all hidden inputs from the form
            $('input[type="hidden"]').each((_, el) => {
                const name = $(el).attr('name');
                const value = $(el).attr('value');
                if (name && value) {
                    formData.append(name, value);
                }
            });

            // Add credentials (ensure case matches HTML exactly)
            formData.set('UserName', this.config.username);
            formData.set('Password', this.config.password);
            formData.set('RememberMe', 'true');

            // Find correct form action
            const formAction = $('form').attr('action') || '/login';
            const postUrl = formAction.startsWith('http') ? formAction : `${BASE_URL}${formAction}`;

            console.log('Logging in to:', postUrl);
            console.log('Form data keys:', Array.from(formData.keys()));

            // Submit login
            const loginResponse = await fetch(postUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Cookie': await this.getCookieString(),
                },
                body: formData.toString(),
                redirect: 'manual',
            });

            console.log('Login response status:', loginResponse.status);

            // Store new cookies (including .ASPXAUTH session cookie)
            const authCookies = loginResponse.headers.getSetCookie?.() || [];
            if (authCookies.length > 0) {
                console.log('Received cookies:', authCookies.map(c => c.split(';')[0]));
            } else {
                console.log('No cookies received in login response');
            }

            for (const cookie of authCookies) {
                await this.cookieJar.setCookie(cookie, BASE_URL);
            }

            // Check if we got the auth cookie or HTMW specific cookies
            const cookies = await this.cookieJar.getCookies(BASE_URL);
            this.isAuthenticated = cookies.some(c => c.key === '.ASPXAUTH' || c.key === 'HTMWLOG' || c.key === '__HTMW');

            if (!this.isAuthenticated) {
                console.error('Login failed: No .ASPXAUTH, HTMWLOG, or __HTMW cookie received');
                console.log('All cookies:', cookies.map(c => c.key));
            } else {
                console.log('Login successful. Authenticated with cookies:', cookies.map(c => c.key).join(', '));
            }

            return this.isAuthenticated;
        } catch (error) {
            console.error('Login error:', error);
            return false;
        }
    }

    async getCookieString(): Promise<string> {
        const cookies = await this.cookieJar.getCookies(BASE_URL);
        return cookies.map(c => `${c.key}=${c.value}`).join('; ');
    }

    async ensureAuthenticated(): Promise<boolean> {
        if (!this.isAuthenticated) {
            return await this.login();
        }
        return true;
    }

    isLoggedIn(): boolean {
        return this.isAuthenticated;
    }

    // Reset session (call on 401 or session expiry)
    async refreshSession(): Promise<boolean> {
        this.isAuthenticated = false;
        this.cookieJar = new CookieJar();
        return await this.login();
    }
}
