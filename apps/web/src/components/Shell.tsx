import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      <div className="mx-auto max-w-5xl px-4 pb-16">
        <header className="flex items-center justify-between py-6 text-sm">
          <Link href="/" className="font-semibold tracking-tight">
            Round robin
          </Link>
          <Link href="/support" className="text-muted hover:text-ink">
            Why this host?
          </Link>
        </header>
        <main>{children}</main>
      </div>
    </>
  );
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-brick/30 bg-brick/5 px-3 py-2 text-sm text-brick">
      {children}
    </p>
  );
}
