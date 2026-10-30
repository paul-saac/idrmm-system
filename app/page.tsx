import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login",
};

const ERROR_MESSAGES: Record<string, string> = {
  account_disabled: "This account has been deactivated. Contact your administrator.",
  no_profile: "Your account has no assigned role yet. Contact your administrator.",
  invalid_link: "That link is invalid or has expired. Please request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="grid min-h-dvh flex-1 bg-zinc-50 md:grid-cols-[47.4%_52.6%]">
      <section
        className="relative hidden min-h-[42rem] overflow-hidden bg-[#292727] text-white md:block"
        aria-label="IDR M&M construction project management"
        style={{
          backgroundImage: "linear-gradient(to right, rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)",
          backgroundSize: "5.347rem 7.083rem",
        }}
      >
        <div className="absolute inset-x-0 top-0 bottom-[13rem] flex translate-x-[40%] items-end justify-center">
        <svg aria-hidden="true" className="h-auto w-[40rem] max-w-none shrink-0 overflow-visible" viewBox="0 0 465 430" fill="none">
          <g transform="translate(46.5 81.4) scale(0.8)">
          <g fill="white" fillOpacity="0.065">
            {/* The unfinished house, roof, and side structures. */}
            <path d="M105 166h258v239H105zM88 158l146-74 146 74H88z" />
            <path d="M165 84h22v80h-22zM286 94h18v70h-18z" />
            <path d="M45 286h61v119H45zM40 280l35-25 36 25H40zM365 285h55v120h-55zM359 279l34-23 33 23h-67z" />
          </g>
          <g fill="white" fillOpacity="0.11">
            <rect x="127" y="214" width="42" height="42" rx="1" />
            <rect x="300" y="214" width="42" height="42" rx="1" />
            <rect x="127" y="280" width="42" height="36" rx="1" />
            <rect x="300" y="280" width="42" height="36" rx="1" />
            <rect x="206" y="309" width="57" height="96" rx="2" />
            <path d="M217 299h35v10h-35zM176 377h119v28H176zM59 337h34v68H59zM375 313h33v30h-33z" />
          </g>
          <g stroke="#292727" strokeWidth="2" strokeOpacity="0.65">
            <path d="M148 214v42m-21-21h42M321 214v42m-21-21h42M148 280v36m-21-18h42M321 280v36m-21-18h42" />
          </g>
          <g stroke="white" strokeOpacity="0.16" strokeWidth="4" strokeLinecap="round">
            <path d="M92 181h284M23 407h414" />
          </g>
          {/* Lattice tower crane: jib, cables, cabin, counterweight and lift. */}
          <g transform="translate(-420 0)">
          <g stroke="white" strokeOpacity="0.32" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M396 67h18v330h-18z" />
            <path d="m405-50-9 85h18l-9-85zm-5 35 10 16m-12 18 14-18m-14 18 15 16" />
            {Array.from({ length: 15 }, (_, index) => {
              const y = 67 + index * 22;
              return <path key={`mast-${index}`} d={`M396 ${y}l18 22m0-22-18 22m0 0h18`} />;
            })}
            <g className="login-crane-arm">
            <g transform="translate(405 65) rotate(40) scale(0.82 1) translate(-405 -65)">
            <path d="M36 56 385 35 405 65H36z" />
            {Array.from({ length: 10 }, (_, index) => {
              const x = 36 + index * 35;
              const top = 56 - index * 2.1;
              const nextTop = top - 2.1;
              return <path key={`jib-${index}`} d={`M${x} 65V${top}l35 ${65 - top}V${nextTop}L${x} 65`} />;
            })}
            <circle cx="36" cy="61" r="3" fill="white" fillOpacity="0.2" />
            </g>
            </g>
            <path d="M405 35 444 49v16h-39zM405 35l20 30V42l19 23" />
            <circle cx="405" cy="-50" r="3" fill="white" fillOpacity="0.32" />
          </g>
          <g stroke="white" strokeOpacity="0.3" strokeWidth="1.5">
            <path className="login-crane-support" d="M179-136 405-50" />
            <path d="M405-50 444 49M405-50l-59 34" />
            <path className="login-crane-load" d="m174-130 3 355 3-351M177 232l-17 30m17-30 29 30" strokeWidth="1" />
          </g>
          <g fill="white">
            <rect x="380" y="36" width="19" height="25" fillOpacity="0.4" />
            <path d="M377 65h49v7h-49zM385 73h33v6h-33z" fillOpacity="0.3" />
          </g>
          <g fill="white" fillOpacity="0.18">
            <path d="M424 66h19v19h-19zM427 86h13v8h-13zM380 397h48v7h-48zM373 404h62v3h-62z" />
            <g className="login-crane-load">
            <rect x="174" y="225" width="6" height="7" rx="1" />
            <g transform="translate(135 0)">
              <path d="M9 262h73v5H9zM15 269h73v5H15zM9 276h73v5H9z" />
            </g>
            </g>
          </g>
          </g>
          <g stroke="white" strokeOpacity="0.14" strokeWidth="1.5">
            {/* Scaffold frames, ladder, and roof timbers. */}
            <path d="M99 190v215m269-215v215M99 260h269M99 333h269M99 402h269M98 260l28 73m-28 0 28-73M368 260l-27 73m27 0-27-73" strokeOpacity="0.32" />
            <g strokeOpacity="0.32">
              <path d="M111 405 129 272M122 405 140 272" />
              {[285, 307, 329, 351, 373, 395].map((y) => {
                const x = 111 + ((405 - y) * 18) / 133;
                return <path key={`ladder-step-${y}`} d={`M${x} ${y}h11`} />;
              })}
            </g>
            <path d="M114 158 234 96l120 62m-120-62v62m-72 0 72-62 72 62" strokeOpacity="0.05" />
          </g>
          <g fill="white" fillOpacity="0.13">
            {/* Stacked lumber, blocks, a bucket, and site cones. */}
            <path d="M27 397h42v7H27zM33 390h31v6H33zM21 374h12v15H21z" />
            <path d="M274 393h21v10h-21zM297 393h21v10h-21zM285 381h21v10h-21z" fillOpacity="0.09" />
            <path d="m395 404 8-25 8 25h-16zm-4 0h24v3h-24zM417 404l6-19 6 19h-12z" fillOpacity="0.09" />
            <circle cx="27" cy="365" r="3" />
            <circle cx="27" cy="355" r="3" />
          </g>
          </g>
        <svg x="-123" y="331.5" width="151" height="75.5" viewBox="0 0 180 90" overflow="visible" fill="none">
          {/* Filled silhouettes match the house; the truck faces right. */}
          <g className="login-truck-enter">
          <g transform="translate(180 0) scale(-1 1)" stroke="white" strokeOpacity="0.1" strokeWidth="0.8" strokeLinejoin="round">
            <path d="M8 56 23 35h34v38H8z" fill="white" fillOpacity="0.12" />
            <path d="M14 73h127v6H14zM57 65h91v8H57z" fill="white" fillOpacity="0.16" stroke="none" />
            <path d="M16 55 27 41h17v18H16z" fill="#292727" stroke="none" />
            <path d="M48 41h6v26h-6z" fill="white" fillOpacity="0.08" stroke="none" />
            <path d="M21 30h38v5H21zM5 65h8v9H5z" fill="white" fillOpacity="0.17" stroke="none" />
            <path d="M8 59h6m34 11h7" strokeOpacity="0.24" />
            <path d="M60 23h69v39H60z" fill="white" fillOpacity="0.075" stroke="none" />
            <path d="M60 43h69M60 55h69" stroke="#292727" strokeOpacity="0.55" />
            {[28, 96].map((x) => (
              <g key={`flatbed-wheel-${x}`}>
                <circle cx={x} cy="80" r="10" fill="#292727" strokeOpacity="0.18" />
                <circle cx={x} cy="80" r="5" fill="white" fillOpacity="0.13" stroke="none" />
                <circle cx={x} cy="80" r="2" fill="#292727" stroke="none" />
              </g>
            ))}
          </g>
          </g>
          <g transform="translate(180 0) scale(-1 1)" stroke="white" strokeOpacity="0.1" strokeWidth="0.8" strokeLinejoin="round">
            {/* Scaffold uprights reach the ground independently of the truck. */}
            <path d="M117 7h57v81h-57z" fill="white" fillOpacity="0.035" stroke="none" />
            <path d="M117 7h3v81h-3zM143 7h3v81h-3zM171 7h3v81h-3zM117 7h57v3h-57zM117 34h57v3h-57zM117 62h57v3h-57z" fill="white" fillOpacity="0.16" stroke="none" />
            <path d="M121 10l22 22m0-22-22 22m26-22 23 22m0-22-23 22M121 38l22 22m0-22-22 22m26-22 23 22m0-22-23 22" strokeOpacity="0.15" strokeWidth="1.5" />
            {/* The opaque sign sits in front of both the vehicle and scaffold. */}
            <path d="M103 51h74v18h-74z" fill="#292727" />
            <path d="M103 51h74v18h-74z" fill="white" fillOpacity="0.13" stroke="none" />
            <path d="m107 66 11-12m-1 12 11-12m-1 12 11-12m-1 12 11-12m-1 12 11-12m-1 12 11-12m-1 12 6-7" stroke="#292727" strokeOpacity="0.7" strokeWidth="4" />
            <path d="M110 69h4v20h-4zM166 69h4v20h-4zM106 87h12v3h-12zM162 87h12v3h-12z" fill="white" fillOpacity="0.16" stroke="none" />
          </g>
        </svg>
        </svg>
        </div>
        {/* Ground shares the scene's 407/430 baseline, spanning the full panel. */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-[14.98rem] h-px bg-white/15" />

        <div className="absolute right-[8%] bottom-[6.5%] left-[10%]">
          <div aria-hidden="true" className="mb-3 h-0.5 w-7 bg-white/45" />
          <p className="text-[0.5625rem] font-medium tracking-[0.2em] text-white/45 uppercase">Construction project management</p>
          <h1 className="mt-1 font-serif text-[1.875rem] leading-tight tracking-tight">IDR M&amp;M</h1>
          <p className="mt-2 text-[0.6875rem] leading-relaxed text-white/50">End-to-end project oversight — from groundbreaking to handover.</p>
        </div>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-6 py-10 sm:px-10" aria-label="Sign in">
        <div className="w-full max-w-[24.5rem]">
          <div className="rounded border border-zinc-200 bg-white p-8 shadow-[0_4px_24px_rgb(0_0_0/5%)]">
              <p className="text-center font-serif text-3xl text-zinc-900">IDR M&amp;M</p>
              <div className="mt-8">
                <h2 className="text-xl font-bold tracking-tight text-zinc-900">Welcome</h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">Sign in to access your project dashboard and site reports.</p>
              </div>
              <div className="mt-6">
                <LoginForm initialError={initialError} />
              </div>
          </div>
          <p className="mt-4 text-[0.5625rem] text-zinc-400">IDR M&amp;M · Construction management</p>
        </div>
      </section>
    </main>
  );
}
