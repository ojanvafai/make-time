export const firebase = {
  firestore: function() {
    return {
      collection: function(_uid: Number) {
        return {
          doc: function() {
            return {
              collection: function() {
                return {
                  onSnapshot: function(f: any) {
                    f({
                      docs: [
                        {
                          id: 0,
                          data: function() {
                            return {
                              queued: false, messageIds: [1, 2, 3]
                            }
                          }
                        },
                        {
                          id: 1,
                          data: function() {
                            return {
                              queued: false, messageIds: [4, 5, 6]
                            }
                          }
                        }
                      ]
                    });  // Needs to pass in a snapshot.
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