import React, { useState } from 'react';
import { Search, Globe, Layout, Code, Activity, Terminal, Shield, Zap } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleScrape = async () => {
    setLoading(true);
    try {
      const response = await fetch('/v1/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white fill-current" />
            </div>
            <span className="text-xl font-bold tracking-tight">FreeCrawl</span>
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-medium uppercase tracking-wider border border-blue-500/20">
              Open Source
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#api" className="hover:text-white transition-colors">API Docs</a>
            <a href="https://github.com" className="hover:text-white transition-colors">GitHub</a>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent"
          >
            Turn the web into <br /> LLM-ready data.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-neutral-400 max-w-2xl mx-auto mb-10"
          >
            FreeCrawl is a self-hosted, free alternative to Firecrawl. Scrape, crawl, and extract structured data using Gemini 2.5 Flash and other free AI providers.
          </motion.p>

          {/* Quick Scrape Tool */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="max-w-3xl mx-auto p-1 bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-blue-500/20 rounded-2xl border border-neutral-800"
          >
            <div className="bg-neutral-900 rounded-xl p-2 flex flex-col md:flex-row gap-2">
              <div className="flex-1 relative">
                <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                <input 
                  type="text" 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full bg-neutral-800 border-none rounded-lg py-3 pl-12 pr-4 text-white placeholder:text-neutral-600 focus:ring-2 focus:ring-blue-500/50 outline-none transition-all"
                />
              </div>
              <button 
                onClick={handleScrape}
                disabled={loading || !url}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <Activity className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    Scrape Now
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>

        {/* Results Section */}
        {result && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-20"
          >
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
              <div className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between bg-neutral-900/50">
                <div className="flex items-center gap-3">
                  <Terminal className="w-5 h-5 text-blue-400" />
                  <span className="font-mono text-sm font-medium text-neutral-300">Scrape Result</span>
                </div>
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-neutral-800" />
                  <div className="w-3 h-3 rounded-full bg-neutral-800" />
                  <div className="w-3 h-3 rounded-full bg-neutral-800" />
                </div>
              </div>
              <div className="p-6">
                <pre className="text-xs font-mono text-neutral-400 overflow-x-auto whitespace-pre-wrap max-h-[500px]">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            </div>
          </motion.div>
        )}

        {/* Features Grid */}
        <div id="features" className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          <FeatureCard 
            icon={<Globe className="w-6 h-6 text-blue-400" />}
            title="Smart Scraper"
            description="Convert any URL into clean Markdown or HTML. Handles SPA, dynamic content, and complex layouts."
          />
          <FeatureCard 
            icon={<Activity className="w-6 h-6 text-purple-400" />}
            title="Recursive Crawl"
            description="Map entire websites automatically. Control depth, limits, and domain constraints with ease."
          />
          <FeatureCard 
            icon={<Code className="w-6 h-6 text-emerald-400" />}
            title="AI Extraction"
            description="Use Gemini 2.5 Flash to extract structured JSON from unstructured web content with custom schemas."
          />
          <FeatureCard 
            icon={<Search className="w-6 h-6 text-orange-400" />}
            title="Web Search"
            description="Integrated search capabilities using free providers. Search and scrape results in one go."
          />
          <FeatureCard 
            icon={<Shield className="w-6 h-6 text-red-400" />}
            title="Self-Hosted"
            description="Run it on your own infrastructure. No monthly fees, no data limits, total privacy."
          />
          <FeatureCard 
            icon={<Zap className="w-6 h-6 text-yellow-400" />}
            title="Free AI Providers"
            description="Compatible with Gemini, Groq, and Ollama. Leverage the best free-tier models available."
          />
        </div>

        {/* API Section */}
        <div id="api" className="bg-neutral-900 border border-neutral-800 rounded-3xl p-8 md:p-12">
          <div className="flex flex-col md:flex-row gap-12">
            <div className="flex-1">
              <h2 className="text-3xl font-bold mb-6">API-First Design</h2>
              <p className="text-neutral-400 mb-8">
                FreeCrawl is built to be integrated. Use our OpenAI-compatible endpoints to power your AI agents, RAG pipelines, and data analysis tools.
              </p>
              <div className="space-y-4">
                <ApiEndpoint method="POST" path="/v1/scrape" />
                <ApiEndpoint method="POST" path="/v1/crawl" />
                <ApiEndpoint method="POST" path="/v1/map" />
                <ApiEndpoint method="POST" path="/v1/extract" />
              </div>
            </div>
            <div className="flex-1 bg-black rounded-2xl p-6 font-mono text-sm text-blue-400 border border-neutral-800">
              <div className="flex items-center gap-2 mb-4 text-neutral-500">
                <Code className="w-4 h-4" />
                <span>example_request.sh</span>
              </div>
              <div className="text-neutral-300">
                <span className="text-purple-400">curl</span> -X POST http://localhost:3000/v1/scrape \<br />
                &nbsp;&nbsp;-H <span className="text-emerald-400">"Content-Type: application/json"</span> \<br />
                &nbsp;&nbsp;-d <span className="text-emerald-400">{"'{"}</span> \<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-emerald-400">{"\"url\": \"https://example.com\","}</span> \<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-emerald-400">{"\"formats\": [\"markdown\"],"}</span> \<br />
                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-emerald-400">{"\"ai_provider\": \"gemini\""}</span> \<br />
                &nbsp;&nbsp;<span className="text-emerald-400">{"'}"}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-neutral-800 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-600 fill-current" />
            <span className="font-bold">FreeCrawl</span>
          </div>
          <div className="flex gap-8 text-sm text-neutral-500">
            <a href="#" className="hover:text-white">Documentation</a>
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
          </div>
          <div className="text-sm text-neutral-600">
            © 2026 FreeCrawl. Built for the open web.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="p-8 bg-neutral-900/50 border border-neutral-800 rounded-2xl hover:border-neutral-700 transition-all group">
      <div className="mb-4 p-3 bg-neutral-800 rounded-xl w-fit group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-3">{title}</h3>
      <p className="text-neutral-400 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function ApiEndpoint({ method, path }: { method: string, path: string }) {
  return (
    <div className="flex items-center gap-4 p-4 bg-black/50 rounded-xl border border-neutral-800">
      <span className={`text-xs font-bold px-2 py-1 rounded ${
        method === 'POST' ? 'bg-blue-500/10 text-blue-400' : 'bg-emerald-500/10 text-emerald-400'
      }`}>
        {method}
      </span>
      <span className="font-mono text-sm text-neutral-300">{path}</span>
    </div>
  );
}
