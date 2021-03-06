class Collection {
  onSnapshot(_onNext: any): any {
    // This is overridden per test.
  }
  orderBy() {
    return this;
  }

  doc(): any {
    return {
      collection: () => {
        return firebase.firestore().collection(0);
      },
      update: () => {},
    };
  }
}

class Firebase {
  constructor() {
    // @ts-expect-error This is weird - FieldValue lives on the method |firestore|
    this.firestore.FieldValue = { delete: () => {} };
  }
  firestore() {
    return this.firestore_;
  }

  auth() {
    return { currentUser: { uid: 1 } };
  }

  update() {}

  private firestore_ = new Firestore();
}

class Firestore {
  constructor() {}
  collection(_uid: Number): any {
    return this.collection_;
  }

  private collection_ = new Collection();
}

export const firebase = new Firebase();
