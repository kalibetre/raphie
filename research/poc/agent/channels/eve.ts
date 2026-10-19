import { eveChannel } from 'eve/channels/eve';
import { none } from 'eve/channels/auth';

// Throwaway local-only test API. Start binds 127.0.0.1; reach it over SSH tunneling.
// Add authentication before exposing it beyond loopback or using real user data.
export default eveChannel({ auth: [none()] });
