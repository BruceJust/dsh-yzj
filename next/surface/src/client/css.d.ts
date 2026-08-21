/** CSS Modules are compiled into the client bundle by tsdown/lightningcss. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
