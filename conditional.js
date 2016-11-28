"format cjs";

function addConditionals(loader) {
	var conditionalRegEx = /#\{[^\}]+\}|#\?.+$/;

	var isNode = typeof process === "object" &&
		{}.toString.call(process) === "[object process]";

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

	function includeInBuild(loader, name) {
		var load = loader.getModuleLoad(name);
		load.metadata.includeInBuild = true;
	}

	// get some node modules through @node-require which is a noop in the browser
	function getGlob() {
		if (isNode) {
			return loader.import("@node-require", { name: module.id })
			.then(function(nodeRequire) {
				return nodeRequire("glob");
			});
		}

		return Promise.resolve();
	}

	loader.normalize = function(name, parentName, parentAddress, pluginNormalize) {
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

			var handleConditionalBuild = function() {};

			//!steal-remove-start
			handleConditionalBuild = function() {
				var setBundlesPromise = Promise.resolve();

				// make sure loader.bundle is an array
				loader.bundle = typeof loader.bundle === "undefined" ?
					[] : loader.bundle;

				if (substitution) {
					var glob = null;
					var nameWithConditional = name;

					// remove the conditional and the trailing slash
					var nameWithoutConditional = name
						.replace(conditionalRegEx, "")
						.replace(/\/+$/, "");

					setBundlesPromise = getGlob()
					.then(function(nodeGlob) {
						// in the browser we don't load the node modules
						if (!nodeGlob) {
							throw new Error("glob module not loaded");
						}

						// make glob available down the pipeline
						glob = nodeGlob;

						return normalize.call(loader, nameWithoutConditional,
							parentName, parentAddress, pluginNormalize);
					})
					.then(function(normalized) {
						return loader.locate({ name: normalized + "/*", metadata: {} });
					})
					.then(function(address) {
						var path = address.replace("file:", "");
						var parts = path.split("/");
						var pattern = parts.pop();

						return new Promise(function(resolve, reject) {
							var options = {
								cwd: parts.join("/"),
								dot: true, nobrace: true, noglobstar: true,
								noext: true, nodir: true
							};

							glob(pattern, options, function(err, files) {
								if (err) { reject(err); }
								resolve(files);
							});
						});
					})
					.then(function(variations) {
						var promises = [];

						for (var i = 0; i < variations.length; i += 1) {
							var variation = variations[i].replace(".js", "");
							var modName = nameWithConditional.replace(conditionalRegEx, variation);

							var promise = loader.normalize.call(loader, modName,
								parentName, parentAddress, pluginNormalize);

							promises.push(promise.then(function(normalized) {
								var isBundle = loader.bundle.indexOf(normalized) !== -1;

								if (!isBundle) {
									loader.bundle.push(normalized);
								}
							}));
						}

						return Promise.all(promises);
					});
				}
				// boolean conditional syntax
				else {
					loader.bundle.push(name.replace(conditionalRegEx, ""));
				}

				name = "@empty";
				return setBundlesPromise.then(function() {
					return normalize.call(loader, name, parentName,
						parentAddress, pluginNormalize);
				});
			};
			//!steal-remove-end

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
					return normalize.call(loader, name, parentName, parentAddress, pluginNormalize);
				} else {
					// call the full normalize in case the module name
					// is an npm package (that needs to be normalized)
					return loader.normalize.call(loader, name, parentName, parentAddress, pluginNormalize);
				}
			};

			var pluginLoader = loader.pluginLoader || loader;
			return pluginLoader["import"](conditionModule, parentName, parentAddress)
			.then(function(m) {
				return pluginLoader
					.normalize(conditionModule, parentName, parentAddress, pluginNormalize)
					.then(function(fullName) {
						includeInBuild(pluginLoader, fullName);
						return m;
					});
			})
			.then(function(m) {
				var isBuild = (loader.env || "").indexOf("build") === 0;

				return isBuild ?
					handleConditionalBuild() :
					handleConditionalEval(m);
			});
		}

		return Promise.resolve(normalize.call(loader, name, parentName, parentAddress, pluginNormalize));
	};
}

if (typeof System !== "undefined") {
	addConditionals(System);
}

