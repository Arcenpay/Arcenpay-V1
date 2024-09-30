// Ambient declarations for the optional Lit Protocol peer dependencies.
//
// @arcenpay/react loads these lazily at runtime and expects the consuming
// application to install them; they are not bundled with the SDK. The
// declarations exist so the SDK typechecks without requiring the (heavy)
// Lit Protocol packages to be installed.
declare module "@lit-protocol/lit-node-client" {
  export const LitNodeClient: any;
}

declare module "@lit-protocol/constants" {
  const constants: any;
  export default constants;
  export const LitNetwork: any;
}

declare module "@lit-protocol/auth-helpers" {
  export const generateAuthSig: any;
  export const checkAndSignAuthMessage: any;
}
