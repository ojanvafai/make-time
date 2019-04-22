export const firebase = {
  firestore: function() {
    return {
      collection: function(_uid: Number) {
        return {
          doc: function() {
            return {
              collection: function() {
                return {
                  onSnapshot: function(_onNext: any) {
                    // This is defined per test.
                  }, orderBy: function() {
                    return this;
                  }
                }
              }
            }
          }
        };
      }
    };
  },
  auth: function() {
    return {currentUser: {uid: 1}};
  }
};