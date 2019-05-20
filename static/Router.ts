// Modified verison of https://github.com/dstillman/pathparser.js
export class Router {
  private rules_: any[];
  private baseParams_: Map<string, string>;

  // universalQueryParameters_ is parameters that should survive navigations.
  // This is useful for developer time parameters like whether to bundle JS.
  constructor(private universalQueryParameters_: string[]) {
    this.rules_ = [];
    this.baseParams_ = new Map();

    if (location.search) {
      let windowQueryParts = window.location.search.substring(1).split('&');
      for (let part of windowQueryParts) {
        var nameValuePair = part.split('=', 2);
        if (universalQueryParameters_.includes(nameValuePair[0]))
          this.baseParams_.set(nameValuePair[0], nameValuePair[1]);
      }
    }
  }

  getParams_(rule: any, pathParts: string[], queryParts: string[]) {
    var params: any = {};
    for (let [k, v] of this.baseParams_) {
      params[k] = v;
    }

    var missingParams: any = {};

    // Don't match if fixed rule is longer than path
    if (rule.parts.length < pathParts.length)
      return false;

    for (let i = 0; i < pathParts.length; i++) {
      var rulePart = rule.parts[i];
      var part = pathParts[i];

      if (part !== undefined) {
        // Assign part to named parameter
        if (rulePart.charAt(0) == ':') {
          params[rulePart.substr(1)] = part;
          continue;
        } else if (rulePart !== part) {
          // If explicit parts differ, no match
          return false;
        }
      } else if (rulePart.charAt(0) != ':') {
        // If no path part and not a named parameter, no match
        return false;
      } else {
        missingParams[rulePart.substr(1)] = true;
      }
    }

    for (let part of queryParts) {
      var nameValue = part.split('=', 2);
      var key = nameValue[0];
      // But ignore empty parameters and don't override named parameters
      // Spaces in query parameters are encoded as '+' in some cases. Need to
      // make them spaces *before* decoding to avoid converting legitimate
      // pluses to spaces.
      if (nameValue.length == 2 && !missingParams[key])
        params[key] = decodeURIComponent(nameValue[1].replace(/\+/g, ' '));
    }

    // Let the page override universal query parameter values after initial page
    // load.
    for (let param of this.universalQueryParameters_) {
      if (param in params)
        this.baseParams_.set(param, params[param]);
    }

    return params;
  }

  add(route: any, handler: (params: any) => void) {
    this.rules_.push({parts: this.parsePath_(route), handler: handler});
  }

  private parsePath_(path: string) {
    if (path.charAt(0) != '/')
      throw ` Path must start with a /. Path: ${path}`;
    // Strip the leading '/'.
    return path.substring(1).split('/');
  }

  private parseQueryString_(path: string) {
    // TODO: Handle if there are multiple question marks.
    let parts = path.split('?');
    if (parts.length === 1)
      return [];
    return parts[1].split('&');
  }

  // Ewww...this can't be async because want to return a promise only in the
  // case where the router handles this location so that the click handler for
  // links can preventDefault synchronously.
  run(location: Location|HTMLAnchorElement|string,
      excludeFromHistory?: boolean) {
    // TODO: Don't allow strings as an argument. Allow Node or Location only.
    let isString = typeof location == 'string';
    let path = isString ? (location as string).split('?')[0] :
                          (<Location|HTMLAnchorElement>location).pathname;
    if (!path)
      return null;

    // Don't route cross origin links.
    if (!isString &&
        window.location.origin != (<Location|HTMLAnchorElement>location).origin)
      return null;

    let pathParts = this.parsePath_(path);
    // Strip the leading '?'.
    let queryParts = isString ?
        this.parseQueryString_(location as string) :
        (<Location|HTMLAnchorElement>location).search.substring(1).split('&');

    for (let rule of this.rules_) {
      var params = this.getParams_(rule, pathParts, queryParts);
      if (params) {
        let paramEntries = [];
        for (let [key, value] of Object.entries(params)) {
          paramEntries.push(`${key}=${value}`);
        }
        let newPath =
            path + (paramEntries.length ? `?${paramEntries.join('&')}` : '');

        if (!excludeFromHistory)
          history.pushState({}, '', newPath);
        return rule.handler(params);
      }
    }
    return null;
  }
}
