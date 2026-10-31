import Image from "next/image";

// ZP-485 placeholder. ZP-481 (design system) and ZP-487 (shell) replace this.
export default function StorefrontComingSoon() {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1>
        <Image
          src="/brand/vyra-lockup.svg"
          alt="VYRA"
          width={500}
          height={422}
          priority
          className="h-auto w-56 sm:w-72"
        />
      </h1>
      <p className="font-serif text-3xl font-semibold sm:text-4xl">Wear Different</p>
      <p className="text-base text-brand-ink-soft">Our new site is coming soon</p>
    </section>
  );
}
