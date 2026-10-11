"use client";
export default function ErrorPage({error,reset}:{error:Error & {digest?:string};reset:()=>void}) {
 return <section className="mx-auto max-w-lg p-6" role="alert">
  <h1 className="text-xl font-semibold">This page could not be loaded</h1>
  <p className="mt-3 text-slate-600">Please try again. If a save was interrupted, check the latest saved data before repeating it.</p>
  {error.digest && <p className="mt-3 text-sm text-slate-500">Reference: {error.digest}</p>}
  <button className="mt-5 rounded-lg bg-slate-950 px-4 py-2 text-white" onClick={reset}>Try again</button>
 </section>;
}
