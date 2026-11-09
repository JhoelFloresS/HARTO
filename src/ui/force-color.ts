// Chalk decides color support on first use. renderToString is not a TTY,
// and the approval diff is specified with color.
if (process.env.FORCE_COLOR === undefined) process.env.FORCE_COLOR = "1";
