import { cn } from "@heroui/react";

/** A logo emitted as a file: in the brand's colours, or one shape to tint. */
export interface Logo {
  src: string;
  colored: boolean;
}

/**
 * A provider's logo. A coloured logo is drawn as it is; a one-colour logo is a mask filled with
 * the text colour, so it follows the theme. Without a logo it shows the name's initial.
 */
export function LogoMark({
  logo,
  name,
  className,
}: {
  logo: Logo | undefined;
  name: string;
  className?: string;
}) {
  if (!logo) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-current/15 text-[0.625rem] leading-none font-semibold uppercase",
          className
        )}>
        {name.charAt(0)}
      </span>
    );
  }

  return logo.colored ? (
    <img
      aria-hidden
      alt=""
      src={logo.src}
      draggable={false}
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  ) : (
    <span
      aria-hidden
      className={cn("inline-block size-4 shrink-0 bg-current", className)}
      style={{ mask: `url("${logo.src}") center / contain no-repeat` }}
    />
  );
}
