import { getUserById, getUsersCollection } from "../lib/game-collections.js";
import { filterByName, paginate, serializeUser } from "../lib/serializers.js";

export function createUserHandlers() {
  return {
    async "user.list"(params) {
      const users = filterByName(Array.from(getUsersCollection()), params.name);
      const { page, total, hasMore } = paginate(users, params);
      return {
        users: page.map((user) => serializeUser(user)),
        total,
        hasMore
      };
    },

    async "user.get"(params) {
      return {
        user: serializeUser(getUserById(params.userId))
      };
    }
  };
}
