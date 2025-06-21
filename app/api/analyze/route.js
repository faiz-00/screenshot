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
        // A section must be visible and have a meaningful height.
        const isPotentialSection = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 100 && rect.height > 100; // Must have some width and height
        };

        const getSections = (container) => {
            return Array.from(container.children).filter(isPotentialSection);
        }

        let container = document.querySelector('main') || document.body;
        let foundSections = getSections(container);

        // If we only find one section, it's likely a wrapper. Look inside it.
        if (foundSections.length <= 1) {
            console.log('Few sections found, trying parent-based analysis...');
            const parent = foundSections[0] || container;
            const innerSections = getSections(parent);
            
            if (innerSections.length > 1) {
                foundSections = innerSections;
            }
        }
        
        console.log(`Detected ${foundSections.length} final sections.`);

        const sectionCoordinates = foundSections.map(el => {
            const rect = el.getBoundingClientRect();
            return {
                x: rect.left,
                y: rect.top + window.scrollY,
                width: rect.width,
                height: rect.height,
            };
        });
        
        return sectionCoordinates;
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

    const image = sharp(masterScreenshotPath);
    const metadata = await image.metadata();

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const screenshotPath = path.join(screenshotsDir, `section-${i + 1}.png`);

        const clip = {
            left: Math.floor(section.x),
            top: Math.floor(section.y),
            width: Math.floor(section.width),
            height: Math.floor(section.height)
        };

        // Prevent clipping errors if coordinates are outside the image bounds
        if (clip.left + clip.width > metadata.width) {
            clip.width = metadata.width - clip.left;
        }
        if (clip.top + clip.height > metadata.height) {
            clip.height = metadata.height - clip.top;
        }
        if (clip.left < 0) clip.left = 0;
        if (clip.top < 0) clip.top = 0;


        console.log(`Extracting section ${i + 1} with clip:`, JSON.stringify(clip));
        await image
            .clone()
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
