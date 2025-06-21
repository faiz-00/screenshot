import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import sharp from 'sharp';

// --- AI Configuration ---
// IMPORTANT: You must create a .env.local file in your project's root
// and add your Google AI API key to it:
// GOOGLE_API_KEY="YOUR_API_KEY_HERE"
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function takeScreenshots(url, page, screenshotsDir) {
    console.log(`Analyzing layout for: ${url}`);
    
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.setViewportSize({ width: 1280, height: 800 });

    console.log('Scrolling page to load all content...');
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 200;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });
    console.log('Page scrolled.');
    await page.waitForTimeout(1000); // Wait for lazy-loaded images

    const sections = await page.evaluate(() => {
        // A section must be visible, not fixed, and have a meaningful height.
        const isPotentialSection = (el) => {
            if (!el || typeof el.getBoundingClientRect !== 'function') return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.position === 'fixed') {
                return false;
            }
            const rect = el.getBoundingClientRect();
            // A section should have substantial area
            return (rect.height > 50 && rect.width > 100);
        };

        const getSections = (container) => Array.from(container.children).filter(isPotentialSection);

        // Start with the body and drill down through single-child wrappers
        let container = document.body;
        let candidateElements = getSections(container);
        while (candidateElements.length === 1) {
            container = candidateElements[0];
            candidateElements = getSections(container);
        }

        // If we still have very few sections, try starting from <main>
        const mainEl = document.querySelector('main');
        if (candidateElements.length <= 2 && mainEl) {
             let mainContainer = mainEl;
             let mainCandidates = getSections(mainContainer);
             while (mainCandidates.length === 1) {
                mainContainer = mainCandidates[0];
                mainCandidates = getSections(mainContainer);
             }
             if (mainCandidates.length > candidateElements.length) {
                candidateElements = mainCandidates;
             }
        }
        
        // Identify if one of the candidates is a "mega-container" holding the real sections
        const totalHeight = candidateElements.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
        const megaContainer = candidateElements.find(el => el.getBoundingClientRect().height > totalHeight * 0.8);
        
        let finalElements;
        if (megaContainer) {
            // If we found a mega-container, its children are the real sections.
            const innerSections = getSections(megaContainer);
            // Don't forget any other small sections that were peers to the mega-container (like a footer).
            const peerSections = candidateElements.filter(el => el !== megaContainer);
            finalElements = [...innerSections, ...peerSections];
        } else {
            // Otherwise, our initial candidates were correct.
            finalElements = candidateElements;
        }

        // Final sanity check and sort by position on page
        finalElements = finalElements.filter(el => el.getBoundingClientRect().height > 50);
        finalElements.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

        return finalElements.map(el => {
            const rect = el.getBoundingClientRect();
            return {
                y_start: rect.top + window.scrollY,
                y_end: rect.bottom + window.scrollY,
            };
        });
    });

    console.log(`Analysis complete. Found ${sections.length} sections.`);

    if (sections.length === 0) {
        console.warn("No sections found after analysis.");
        return 0;
    }

    // Take one master screenshot of the entire page
    const masterScreenshotPath = path.join(screenshotsDir, 'master.png');
    await page.screenshot({ path: masterScreenshotPath, fullPage: true });
    console.log('Master screenshot saved. Slicing sections...');

    // Use sharp to slice the master screenshot
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const screenshotPath = path.join(screenshotsDir, `section-${i + 1}.png`);

        const clip = {
            left: 0,
            top: Math.round(section.y_start),
            width: 1280, // The viewport width we set
            height: Math.round(section.y_end - section.y_start)
        };

        // Skip sections that might be invalid
        if (clip.height <= 0 || clip.width <= 0) {
            console.warn(`Skipping invalid section ${i + 1}:`, clip);
            continue;
        }

        console.log(`Extracting section ${i + 1} with clip:`, JSON.stringify(clip));
        
        await sharp(masterScreenshotPath)
            .extract(clip)
            .toFile(screenshotPath);
            
        console.log(`Saved screenshot: ${screenshotPath}`);
    }

    // Clean up the master screenshot
    await fs.unlink(masterScreenshotPath);

    return sections.length;
}

export async function POST(request) {
    const { url } = await request.json();

    if (!url) {
        return new Response(JSON.stringify({ error: 'URL is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let browser = null;
    try {
        console.log('Launching browser...');
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        const urlHost = new URL(url).hostname.replace(/www\./, '');
        const date = new Date().toISOString();
        const uniqueDir = `${urlHost}-${date}`.replace(/:/g, '-');
        const outputDir = path.join(process.cwd(), 'public', 'screenshots', uniqueDir);
        await fs.mkdir(outputDir, { recursive: true });

        const numScreenshots = await takeScreenshots(url, page, outputDir);
        const screenshotPaths = Array.from({ length: numScreenshots }, (_, i) => `/screenshots/${uniqueDir}/section-${i + 1}.png`);
        
        return new Response(JSON.stringify({ screenshots: screenshotPaths }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error in POST handler:', error);
        return new Response(JSON.stringify({ error: `Failed to analyze the URL. ${error.message}` }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    } finally {
        if (browser) {
            console.log('Browser closed.');
            await browser.close();
        }
    }
}
