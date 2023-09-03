function introspectAccessToken(r) {
  r.subrequest("/_oauth2_send_request",
    function(reply) {
      if (reply.status == 200) {
        const response = JSON.parse(reply.responseText);
        if (response.active == true) {
          // Forward members of the token object to the requests header for the
          // backend application to have information on the authorized user
          for (const entry in response) {
            const key = entry;
            const value = response[entry];
            r.log(`OAuth2 Token-${key}: ${value}`);
            r.headersOut[`Token-${key}`] = value;
          }
          r.status = 204;
          r.sendHeader();
          r.finish();
        } else {
          r.return(403); // Token is invalid, return forbidden code
        }
      } else {
        r.return(401); // Unexpected response, return 'auth required'
      }
    }
  );
}

export default { introspectAccessToken }
