'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [screenshots, setScreenshots] = useState([]);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setScreenshots([]);
    setError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'An unknown error occurred.');
      }

      const data = await response.json();
      setScreenshots(data.screenshots);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center p-12 bg-gray-50">
      <div className="z-10 w-full max-w-5xl items-center justify-between font-mono text-sm lg:flex">
        <h1 className="text-4xl font-bold text-center text-gray-800 mb-2">Landing Page Section Analyzer</h1>
      </div>
       <p className="text-center text-gray-500 mb-8">
          Enter a URL to automatically capture screenshots of its main sections.
        </p>

      <form onSubmit={handleSubmit} className="w-full max-w-2xl flex gap-2 mb-8">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          required
          className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </form>

      {loading && (
         <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
      )}

      {error && <p className="text-red-500">Error: {error}</p>}

      {screenshots.length > 0 && (
        <div className="w-full max-w-5xl mt-8 grid grid-cols-1 gap-8">
          {screenshots.map((src, index) => (
            <div key={src} className="border border-gray-200 rounded-lg overflow-hidden shadow-lg">
               <h2 className="bg-gray-100 p-3 text-lg font-semibold text-gray-700">Section {index + 1}</h2>
              <img src={`${src}?t=${new Date().getTime()}`} alt={`Section ${index + 1} screenshot`} className="w-full"/>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
