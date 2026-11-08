/* Route legacy R2 development URLs through the deployed audio Worker. */
(() => {
  const workerOrigin = 'https://jamukot-audio.originragnarok05.workers.dev';
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (!response.ok || !requestUrl || !/data\/tracks\.json(?:[?#]|$)/.test(requestUrl)) {
      return response;
    }

    const tracksJson = await response.text();
    const routedJson = tracksJson.replace(/https:\/\/[^/"\\]+\.r2\.dev(?=\/)/g, workerOrigin);
    return new Response(routedJson, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
})();
