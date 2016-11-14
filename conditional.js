/*
 * Conditions Extension
 *
 *   Allows a condition module to alter the resolution of an import via syntax:
 *
 *     import $ from "jquery/#{browser}";
 *
 *   Will first load the module "browser" via `System.import("browser")` and
 *   take the default export of that module.
 *   If the default export is not a string, an error is thrown.
 *
 *   We then substitute the string into the require to get the conditional resolution
 *   enabling environment-specific variations like:
 *
 *     import $ from "jquery/ie"
 *     import $ from "jquery/firefox"
 *     import $ from "jquery/chrome"
 *     import $ from "jquery/safari"
 *
 *   It can be useful for a condition module to define multiple conditions.
 *   This can be done via the `.` modifier to specify a member expression:
 *
 *     import "jquery/#{browser.grade}"
 *
 *   Where the `grade` export of the `browser` module is taken for substitution.
 *
 *   Note that `/` and a leading `.` are not permitted within conditional modules
 *   so that this syntax can be well-defined.
 *
 *
 * Boolean Conditionals
 *
 *   For polyfill modules, that are used as imports but have no module value,
 *   a binary conditional allows a module not to be loaded at all if not needed:
 *
 *     import "es5-shim#?conditions.needs-es5shim"
 *
 */

function addConditionals(loader) {
	var conditionalRegEx = /#\{[^\}]+\}|#\?.+$/;

	if (loader._extensions) {
		loader._extensions.push(addConditionals);
	}

	loader.set("@@conditional-helpers", loader.newModule({
		isConditionalModuleName: function(moduleName){
			return conditionalRegEx.test(moduleName);
		}
	}));

	var normalize = loader.normalize;

	function readMemberExpression(p, value) {
		var pParts = p.split(".");
		while (pParts.length) {
			value = value[pParts.shift()];
		}
		return value;
	}

	function isArray(arg) {
		return Object.prototype.toString.call(arg) === "[object Array]";
	}

	function includeInBuild(loader, name) {
		var load = loader.getModuleLoad(name);
		load.metadata.includeInBuild = true;
	}

	loader.normalize = function(name, parentName, parentAddress) {
		var loader = this;

		var conditionalMatch = name.match(conditionalRegEx);
		if (conditionalMatch) {
			var substitution = conditionalMatch[0][1] !== "?";

			var conditionModule = substitution ?
				conditionalMatch[0].substr(2, conditionalMatch[0].length - 3) :
				conditionalMatch[0].substr(2);

			if (conditionModule[0] === "." || conditionModule.indexOf("/") !== -1) {
				throw new TypeError(
					"Invalid condition " +
					conditionalMatch[0] +
					"\n\tCondition modules cannot contain . or / in the name."
				);
			}

			var conditionExport = "default";
			var conditionExportIndex = conditionModule.indexOf(".");

			if (conditionExportIndex !== -1) {
				conditionExport = conditionModule.substr(conditionExportIndex + 1);
				conditionModule = conditionModule.substr(0, conditionExportIndex);
			}

			var booleanNegation = !substitution && conditionModule[0] === "~";
			if (booleanNegation) {
				conditionModule = conditionModule.substr(1);
			}

			var handleConditionalBuild = function(m) {
				loader.bundle = typeof loader.bundle === "undefined" ?
					[] : loader.bundle;

				if (substitution) {
					var cases = readMemberExpression("cases", m);

					cases = isArray(cases) ? cases : [];

					// if conditionModule define a `cases` property, use it
					// to add bundles for each possible option that might be
					// imported using string substitution.
					for (var i = 0; i < cases.length; i += 1) {
						var mod = cases[i];
						var modName = name.replace(conditionalRegEx, mod);
						var isBundle = loader.bundle.indexOf(modName) !== -1;

						if (modName && !isBundle) {
							loader.bundle.push(modName);
						}
					}
				}
				else {
					loader.bundle.push(name.replace(conditionalRegEx, ""));
				}

				name = "@empty";
				return normalize.call(loader, name, parentName, parentAddress);
			};

			var handleConditionalEval = function(m) {
				var conditionValue = (typeof m === "object") ?
					readMemberExpression(conditionExport, m) : m;

				if (substitution) {
					if (typeof conditionValue !== "string") {
						throw new TypeError(
							"The condition value for " +
							conditionalMatch[0] +
							" doesn't resolve to a string."
						);
					}

					name = name.replace(conditionalRegEx, conditionValue);
				}
				else {
					if (typeof conditionValue !== "boolean") {
						throw new TypeError(
							"The condition value for " +
							conditionalMatch[0] +
							" isn't resolving to a boolean."
						);
					}
					if (booleanNegation) {
						conditionValue = !conditionValue;
					}
					if (!conditionValue) {
						name = "@empty";
					} else {
						name = name.replace(conditionalRegEx, "");
					}
				}

				if (name === "@empty") {
					return normalize.call(loader, name, parentName, parentAddress);
				} else {
					// call the full normalize in case the module name
					// is an npm package (that needs to be normalized)
					return loader.normalize.call(loader, name, parentName, parentAddress);
				}
			};

			var pluginLoader = loader.pluginLoader || loader;
			return pluginLoader["import"](conditionModule, parentName, parentAddress)
			.then(function(m) {
				return pluginLoader
					.normalize(conditionModule, parentName, parentAddress)
					.then(function(fullName) {
						includeInBuild(pluginLoader, fullName);
						return m;
					});
			})
			.then(function(m) {
				var isBuild = (loader.env || "").indexOf("build") === 0;

				return isBuild ?
					handleConditionalBuild(m) :
					handleConditionalEval(m);
			});
		}

		return Promise.resolve(normalize.call(loader, name, parentName, parentAddress));
	};
}

if (typeof System !== "undefined") {
	addConditionals(System);
}

